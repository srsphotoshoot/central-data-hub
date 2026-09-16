"""
Optional Hugging Face Dataset-backed persistence for the matcher's FAISS index +
label map. Fully inert unless both HF_TOKEN and HF_DATASET_REPO are set in the
environment — local/PM2 runs (no such env vars) are completely unaffected.

Why this exists: hosted compute (e.g. Cloud Run) has no durable local disk across
restarts/cold-starts, so the index+labels need to live somewhere durable. A private
HF Dataset repo is free and simple: pull() once at process start, push() after
every write (add_product/delete_product's save_db()).
"""
import os
import shutil
import logging
import threading
import time

logger = logging.getLogger("cdh-matcher")

HF_TOKEN = os.environ.get("HF_TOKEN")
HF_DATASET_REPO = os.environ.get("HF_DATASET_REPO")  # e.g. "sourya74/cdh-matcher-index"

ENABLED = bool(HF_TOKEN and HF_DATASET_REPO)

# HF Datasets caps repo commits at 128/hour (hit live, 5 Sep 2026 — a push
# from this exact matcher got a real 429, see push()'s own error handling
# below). That cap was already close with the OLD fully-synchronous /add
# (~1 push/minute during a Drive backfill); making /add respond immediately
# and push in the background (matcher_server.py's BackgroundTasks) removes
# the ~60s-per-request pacing that used to keep pushes naturally spaced out
# — a fast burst of adds could now fire far more than 128 pushes/hour on its
# own. mark_dirty() below coalesces any number of adds/deletes within one
# PUSH_INTERVAL_SECONDS window into a single push, capping the rate at
# 3600/PUSH_INTERVAL_SECONDS commits/hour regardless of request volume.
PUSH_INTERVAL_SECONDS = int(os.environ.get("HF_PUSH_INTERVAL_SECONDS", "30"))


def pull(index_file, map_file):
    """Download the latest index+labels from the HF dataset repo, if present, into
    the given local paths. No-op (and no error) if the repo/files don't exist yet
    (first-ever deploy) or if HF sync isn't configured."""
    if not ENABLED:
        return
    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import EntryNotFoundError, RepositoryNotFoundError

    for dest in (index_file, map_file):
        fname = os.path.basename(dest)
        try:
            downloaded = hf_hub_download(
                repo_id=HF_DATASET_REPO, repo_type="dataset", filename=fname, token=HF_TOKEN
            )
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy(downloaded, dest)
            logger.info(f"[hf_sync] pulled {fname} from {HF_DATASET_REPO}")
        except (EntryNotFoundError, RepositoryNotFoundError):
            logger.info(f"[hf_sync] {fname} not found in {HF_DATASET_REPO} yet (first deploy?) — skipping")
        except Exception as e:
            logger.warning(f"[hf_sync] could not pull {fname}: {e}")


def push(index_file, map_file):
    """Upload the current index+labels to the HF dataset repo. Best-effort — a
    failure here is logged but never raised, so it can't take down a live request."""
    if not ENABLED:
        return
    from huggingface_hub import HfApi

    try:
        api = HfApi(token=HF_TOKEN)
        for path in (index_file, map_file):
            if os.path.exists(path):
                api.upload_file(
                    path_or_fileobj=path,
                    path_in_repo=os.path.basename(path),
                    repo_id=HF_DATASET_REPO,
                    repo_type="dataset",
                    token=HF_TOKEN,
                )
        logger.info(f"[hf_sync] pushed index+labels to {HF_DATASET_REPO}")
    except Exception as e:
        logger.error(f"[hf_sync] push failed (local save already succeeded, will retry on next write): {e}")


def pull_thumbnails(thumb_dir):
    """Download the full thumbnails/ folder from the HF dataset repo into thumb_dir.
    Added 2026-09-10 alongside the keypoint re-ranker (matcher_service.py's
    _keypoint_rerank), which needs one reference photo per product to compare
    against — same durability problem as the index/labels: Cloud Run has no disk
    across restarts, so without this, every cold start would come up with zero
    thumbnails and the re-ranker would silently no-op forever. No-op (and no error)
    if the folder doesn't exist yet in the repo, or if HF sync isn't configured."""
    if not ENABLED:
        return
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import RepositoryNotFoundError

    try:
        os.makedirs(thumb_dir, exist_ok=True)
        downloaded_root = snapshot_download(
            repo_id=HF_DATASET_REPO, repo_type="dataset", token=HF_TOKEN,
            allow_patterns=["thumbnails/*"],
        )
        src = os.path.join(downloaded_root, "thumbnails")
        if os.path.isdir(src):
            for fname in os.listdir(src):
                shutil.copy(os.path.join(src, fname), os.path.join(thumb_dir, fname))
            logger.info(f"[hf_sync] pulled {len(os.listdir(src))} thumbnails from {HF_DATASET_REPO}")
        else:
            logger.info(f"[hf_sync] no thumbnails/ folder in {HF_DATASET_REPO} yet (first deploy?) — skipping")
    except RepositoryNotFoundError:
        logger.info(f"[hf_sync] {HF_DATASET_REPO} not found — skipping thumbnail pull")
    except Exception as e:
        logger.warning(f"[hf_sync] could not pull thumbnails: {e}")


def push_thumbnails(thumb_dir):
    """Upload the whole thumbnails/ folder to the HF dataset repo. Best-effort, same
    as push(). Only called from the same coalesced background pusher as the index/
    labels push (see mark_dirty/_pusher_loop below) — thumbnails only change when a
    genuinely new product is added, so this rides the existing push cadence instead
    of adding a separate one."""
    if not ENABLED or not os.path.isdir(thumb_dir):
        return
    from huggingface_hub import HfApi

    try:
        api = HfApi(token=HF_TOKEN)
        api.upload_folder(
            folder_path=thumb_dir,
            path_in_repo="thumbnails",
            repo_id=HF_DATASET_REPO,
            repo_type="dataset",
            token=HF_TOKEN,
        )
        logger.info(f"[hf_sync] pushed thumbnails to {HF_DATASET_REPO}")
    except Exception as e:
        logger.error(f"[hf_sync] thumbnail push failed (local files already saved, will retry on next write): {e}")


_dirty = False
_lock = threading.Lock()
_pusher_thread = None


def mark_dirty(index_file, map_file, thumb_dir=None):
    """Non-blocking: flags that index_file/map_file (and, if given, thumb_dir) have
    unpushed local changes, and ensures the background pusher thread is running. Call
    this from a per-request hot path (matcher_server.py's BackgroundTasks) instead
    of push()/push_thumbnails() directly — any number of calls within one
    PUSH_INTERVAL_SECONDS window collapse into a single push of whatever's on disk
    when that window's flush actually runs (push() always uploads the CURRENT file
    contents, not a diff, so coalescing loses nothing — a flush always reflects every
    add/delete that happened before it fired). No-op if HF sync isn't configured,
    same as push(). thumb_dir added 2026-09-10 for the keypoint re-ranker's reference
    photos — optional so existing callers that only pass index_file/map_file keep
    working unchanged."""
    global _dirty, _pusher_thread
    if not ENABLED:
        return
    with _lock:
        _dirty = True
        if _pusher_thread is None:
            _pusher_thread = threading.Thread(
                target=_pusher_loop, args=(index_file, map_file, thumb_dir), daemon=True
            )
            _pusher_thread.start()


def _pusher_loop(index_file, map_file, thumb_dir=None):
    global _dirty
    while True:
        time.sleep(PUSH_INTERVAL_SECONDS)
        with _lock:
            was_dirty = _dirty
            _dirty = False
        if was_dirty:
            push(index_file, map_file)
            if thumb_dir:
                push_thumbnails(thumb_dir)

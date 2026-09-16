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


THUMBNAILS_ARCHIVE_NAME = "thumbnails.tar.gz"


def pull_thumbnails(thumb_dir):
    """Download ONE archive (thumbnails.tar.gz) from the HF dataset repo and extract
    it into thumb_dir. Added 2026-09-10 alongside the keypoint re-ranker
    (matcher_service.py's _keypoint_rerank), which needs one reference photo per
    product to compare against — same durability problem as the index/labels: Cloud
    Run has no disk across restarts, so without this, every cold start would come up
    with zero thumbnails.

    Was originally ~1000 individual files pulled via snapshot_download — reworked
    the same day after two real failures live: (1) pulling 1047 files inline in
    load_db() blocked the container from ever binding to its port and Cloud Run's
    startup probe killed the deploy; moving the pull to a background thread fixed
    that, but then (2) with min-instances=0, Cloud Run scaling the idle instance
    down mid-pull (observed live: progress fell from 63% back to 4% after a scale
    down + cold restart) meant the ~1000-file pull could get interrupted and
    restarted indefinitely under real sporadic traffic, never actually finishing.
    A single archive fixes both: pulling it is one fast download (seconds, like the
    index/labels files), so even a full restart mid-pull just repeats a cheap
    operation instead of resuming a 1000-step one from zero.

    No-op (and no error) if the archive doesn't exist yet in the repo (first
    deploy after this change, before the first push_thumbnails() has run), or if
    HF sync isn't configured."""
    if not ENABLED:
        return
    import tarfile
    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import EntryNotFoundError, RepositoryNotFoundError

    try:
        os.makedirs(thumb_dir, exist_ok=True)
        archive_path = hf_hub_download(
            repo_id=HF_DATASET_REPO, repo_type="dataset", filename=THUMBNAILS_ARCHIVE_NAME, token=HF_TOKEN,
        )
        with tarfile.open(archive_path, "r:gz") as tar:
            tar.extractall(path=thumb_dir)
        n = len(os.listdir(thumb_dir))
        logger.info(f"[hf_sync] pulled+extracted {THUMBNAILS_ARCHIVE_NAME} from {HF_DATASET_REPO} ({n} thumbnails)")
    except (EntryNotFoundError, RepositoryNotFoundError):
        logger.info(f"[hf_sync] {THUMBNAILS_ARCHIVE_NAME} not found in {HF_DATASET_REPO} yet — skipping")
    except Exception as e:
        logger.warning(f"[hf_sync] could not pull thumbnails: {e}")


def push_thumbnails(thumb_dir):
    """Tar+gzip the whole thumbnails/ folder into one archive and upload it as a
    single file. Best-effort, same as push(). Only called from the same coalesced
    background pusher as the index/labels push (see mark_dirty/_pusher_loop below)
    — thumbnails only change when a genuinely new product is added, so this rides
    the existing push cadence instead of adding a separate one. Re-archives the
    whole folder each call rather than diffing (simple, and thumbnails only total
    tens of MB) — see pull_thumbnails' docstring for why this moved off
    upload_folder's one-file-per-thumbnail approach."""
    if not ENABLED or not os.path.isdir(thumb_dir):
        return
    import tarfile
    import tempfile
    from huggingface_hub import HfApi

    try:
        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            archive_path = tmp.name
        with tarfile.open(archive_path, "w:gz") as tar:
            for fname in os.listdir(thumb_dir):
                tar.add(os.path.join(thumb_dir, fname), arcname=fname)

        api = HfApi(token=HF_TOKEN)
        api.upload_file(
            path_or_fileobj=archive_path,
            path_in_repo=THUMBNAILS_ARCHIVE_NAME,
            repo_id=HF_DATASET_REPO,
            repo_type="dataset",
            token=HF_TOKEN,
        )
        logger.info(f"[hf_sync] pushed {THUMBNAILS_ARCHIVE_NAME} to {HF_DATASET_REPO}")
    except Exception as e:
        logger.error(f"[hf_sync] thumbnail push failed (local files already saved, will retry on next write): {e}")
    finally:
        try:
            os.remove(archive_path)
        except Exception:
            pass


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

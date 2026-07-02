import sys
import os
import json
import logging
import asyncio
import requests
from datetime import datetime
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters, ConversationHandler, CallbackQueryHandler
from PIL import Image
from io import BytesIO
from services.matcher_service import matcher

load_dotenv()

MATCHER_ADD_URL = 'http://localhost:8000/api/v1/matcher/add'

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger("telegram-bot")

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

LEARNING_LOG = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "matcher", "learning_log.jsonl"
)

# Conversation states
AWAITING_CORRECT_COLOR  = 1  # color buttons shown after design match
AWAITING_CORRECT_DESIGN = 2  # user tapped "Wrong Design?" — awaiting text input


# ── learning helpers ──────────────────────────────────────────────────────────

def log_learning(user_id, photo_file_id, matched_design, was_correct, correct_product, confidence):
    os.makedirs(os.path.dirname(LEARNING_LOG), exist_ok=True)
    entry = {
        "ts":             datetime.utcnow().isoformat(),
        "user_id":        user_id,
        "photo_file_id":  photo_file_id,
        "matched_design": matched_design,
        "was_correct":    was_correct,
        "correct_product": correct_product,
        "confidence":     round(confidence, 4),
    }
    with open(LEARNING_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


async def learn_from_photo(bot, photo_file_id: str, product_name: str):
    """
    Route corrections through the API so the API's in-memory FAISS index is the
    single writer — avoids the race condition where the bot's stale in-memory copy
    would overwrite vectors added by the API after bot startup.
    """
    file = await bot.get_file(photo_file_id)
    photo_bytes = bytes(await file.download_as_bytearray())

    def _post():
        resp = requests.post(
            MATCHER_ADD_URL,
            data={'product_name': product_name},
            files=[('files', (f'{product_name}.jpg', BytesIO(photo_bytes), 'image/jpeg'))],
            timeout=60
        )
        if resp.status_code != 200:
            raise Exception(f"API {resp.status_code}: {resp.text}")
        return resp.json().get('vectors_added', 1)

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _post)


def _build_color_buttons(variants):
    """Build inline keyboard rows (3 per row) from a list of product names."""
    buttons, row = [], []
    for product in sorted(variants):
        color = product.split('-', 2)[-1]
        row.append(InlineKeyboardButton(color, callback_data=f"color:{product}"))
        if len(row) == 3:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append([InlineKeyboardButton("❌ Wrong Design?", callback_data="wrong_design")])
    return buttons


# ── handlers ──────────────────────────────────────────────────────────────────

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Welcome to the Dress Matcher AI Bot!\n\n"
        "Send me a photo of a dress — I'll identify the design and show all color variants.\n"
        "Tap the correct color to confirm and help train the AI. 🧠"
    )
    return ConversationHandler.END


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Send a clear photo of any dress.\n\n"
        "I'll match the *design pattern* (not color) and show all color variants.\n"
        "Tap the correct color → AI learns from it.\n"
        "If the design is wrong, tap *Wrong Design?* and type the correct design number.",
        parse_mode='Markdown'
    )
    return ConversationHandler.END


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Process incoming photo: match design, show color buttons."""
    if not update.message.photo:
        return ConversationHandler.END

    photo = update.message.photo[-1]
    context.user_data['last_photo_id'] = photo.file_id

    status_msg = await update.message.reply_text("🔍 Analyzing design... Please wait.")

    try:
        file = await context.bot.get_file(photo.file_id)
        photo_bytes = await file.download_as_bytearray()
        img = Image.open(BytesIO(photo_bytes))

        loop = asyncio.get_event_loop()
        similarity, best_product, _ = await loop.run_in_executor(None, matcher.search, [img])

        # Extract design code from the matched product (SRS-6002-GOLD → SRS-6002)
        parts = best_product.split('-')
        design_code = '-'.join(parts[:2]) if len(parts) >= 2 else best_product

        context.user_data['last_matched_design'] = design_code
        context.user_data['last_similarity']      = similarity

        logger.info(f"MATCH: {best_product} → design {design_code} | Score: {similarity:.4f}")

        # Get all color variants for the matched design
        all_products = matcher.get_products()
        prefix = design_code.upper() + '-'
        variants = [p['name'] for p in all_products if p['name'].upper().startswith(prefix)]

        if not variants:
            await status_msg.edit_text(
                f"⚠️ Design *{design_code}* matched but no color variants found in DB.",
                parse_mode='Markdown'
            )
            return ConversationHandler.END

        design_num = design_code.replace('SRS-', '')
        THRESHOLD = 0.80
        if similarity >= THRESHOLD:
            header = (
                f"✅ *Design {design_num}* found! ({similarity*100:.1f}%)\n\n"
                f"Select the correct color:"
            )
        else:
            header = (
                f"❓ *Best guess: Design {design_num}* ({similarity*100:.1f}%)\n\n"
                f"Select the correct color (or tap Wrong Design?):"
            )

        await status_msg.edit_text(
            header,
            parse_mode='Markdown',
            reply_markup=InlineKeyboardMarkup(_build_color_buttons(variants))
        )
        return AWAITING_CORRECT_COLOR

    except Exception as e:
        logger.error(f"Error processing photo: {e}")
        await status_msg.edit_text("⚠️ An error occurred. Please try again.")
        return ConversationHandler.END


async def handle_wrong_design(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """User tapped 'Wrong Design?' — ask for the correct design number."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        text=f"{query.message.text}\n\n*Type the correct design number _(e.g. 8437):_*",
        parse_mode='Markdown'
    )
    return AWAITING_CORRECT_DESIGN


async def handle_design_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """User typed a design number — show color buttons for that design."""
    import re as _re
    raw = update.message.text.strip().upper()
    m = _re.search(r'(\d+)', raw)
    if not m:
        await update.message.reply_text(
            "Please type only the design number _(e.g. 8437)_", parse_mode='Markdown'
        )
        return AWAITING_CORRECT_DESIGN

    design_code = m.group(1)

    all_products = matcher.get_products()
    prefix = f"SRS-{design_code}-"
    variants = [p['name'] for p in all_products if p['name'].upper().startswith(prefix)]

    if not variants:
        await update.message.reply_text(
            f"❌ Design *{design_code}* not found in DB.\n"
            f"Please check and try again _(e.g. 8437)_:",
            parse_mode='Markdown'
        )
        return AWAITING_CORRECT_DESIGN

    await update.message.reply_text(
        f"*Design {design_code}* — select the color:",
        parse_mode='Markdown',
        reply_markup=InlineKeyboardMarkup(_build_color_buttons(variants))
    )
    return AWAITING_CORRECT_COLOR


async def handle_color_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """User tapped a color button — learn from the photo."""
    query = update.callback_query
    await query.answer()

    correct_label  = query.data.split("color:", 1)[1]
    photo_file_id  = context.user_data.get('last_photo_id')
    matched_design = context.user_data.get('last_matched_design', 'Unknown')
    similarity     = context.user_data.get('last_similarity', 0.0)
    user_id        = query.from_user.id

    if not photo_file_id:
        await query.edit_message_text("Please send the photo again.")
        return ConversationHandler.END

    # Determine if the matched design was correct
    selected_design = '-'.join(correct_label.split('-')[:2]).upper()
    was_correct     = (selected_design == matched_design.upper())

    await query.edit_message_text(
        f"⏳ Learning *{correct_label}*...", parse_mode='Markdown'
    )

    try:
        added = await learn_from_photo(context.bot, photo_file_id, correct_label)
        log_learning(user_id, photo_file_id, matched_design, was_correct, correct_label, similarity)
        logger.info(
            f"LEARNED: {correct_label} | design_correct={was_correct} | "
            f"+{added} | conf={similarity:.3f}"
        )

        if was_correct:
            msg = (
                f"✅ *Saved!* Photo added to *{correct_label}*.\n"
                f"_I'll match similar photos better next time._ 🧠"
            )
        else:
            msg = (
                f"✅ *Saved!* Photo added to *{correct_label}*.\n"
                f"_(Previous wrong match: {matched_design})_\n\n"
                f"_I'll remember this next time._ 🧠"
            )

        await query.edit_message_text(msg, parse_mode='Markdown')
    except Exception as e:
        logger.error(f"Error in color selection: {e}")
        await query.edit_message_text("⚠️ Could not save. Please try again.")

    context.user_data.pop('last_photo_id', None)
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


# ── startup ───────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if not TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not found in environment variables!")
        exit(1)

    logger.info("Starting Telegram Bot — Design-level matching, color-agnostic...")
    app = ApplicationBuilder().token(TOKEN) \
        .connect_timeout(30.0).read_timeout(30.0) \
        .write_timeout(30.0).pool_timeout(30.0).build()

    conv = ConversationHandler(
        entry_points=[MessageHandler(filters.PHOTO, handle_photo)],
        states={
            AWAITING_CORRECT_COLOR: [
                CallbackQueryHandler(handle_color_selection, pattern='^color:'),
                CallbackQueryHandler(handle_wrong_design,    pattern='^wrong_design$'),
                MessageHandler(filters.PHOTO, handle_photo),
            ],
            AWAITING_CORRECT_DESIGN: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_design_input),
                MessageHandler(filters.PHOTO, handle_photo),
            ],
        },
        fallbacks=[CommandHandler('cancel', cancel)]
    )

    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('help',  help_command))
    app.add_handler(conv)
    app.run_polling()

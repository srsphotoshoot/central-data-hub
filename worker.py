import time
import logging
from ingestion import fetch_and_store_data
from processing import process_raw_data


# Configure logging for the worker
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] CDH-WORKER: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("worker")

INTERVAL = 5 # Real-time speed for testing

def run_pulse():
    logger.info("💓 CDH Automation Pulse Started")
    logger.info(f"Target Interval: {INTERVAL} seconds")
    
    while True:
        try:
            # 1. Mock Ingestion (Inject a new random event)
            # seed_one() # Disabled mock injection
            
            # 2. Processing & Dispatching
            process_raw_data()
            
            time.sleep(INTERVAL)
        except Exception as e:
            logger.error(f"Worker heartbeat failed: {e}")
            time.sleep(10) # Wait a bit longer before retry

if __name__ == "__main__":
    run_pulse()

import time
import logging
from iqoptionapi.stable_api import IQ_Option
from config import IQ_EMAIL, IQ_PASSWORD, IQ_ACCOUNT_TYPE

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def connect_to_iqoption(max_retries=5, base_delay=5):
    """
    Connects to IQ Option using credentials from config.
    Retries with exponential backoff on transient failures.
    Returns the connected API instance or None if all attempts fail.
    """
    for attempt in range(1, max_retries + 1):
        logger.info(f"Connection attempt {attempt}/{max_retries}...")
        api = IQ_Option(IQ_EMAIL, IQ_PASSWORD)

        try:
            status, reason = api.connect()
        except Exception as e:
            logger.warning(f"Attempt {attempt} raised exception: {e}")
            status, reason = False, str(e)

        if status:
            logger.info("Successfully connected to IQ Option.")
            
            # --- DYNAMIC ASSET OPCODES PATCH ---
            # iqoptionapi hardcodes OP_code.ACTIVES, missing many modern pairs (e.g. APPLE-OTC, BTCUSD-OTC).
            # This patch dynamically injects ALL current broker assets into OP_code.ACTIVES so 
            # get_candles and buy() work flawlessly for non-forex and weekend OTC pairs.
            try:
                import iqoptionapi.constants as OP_code
                init_data = api.get_all_init()
                if init_data and "result" in init_data:
                    for mode in ["turbo", "binary", "digital"]:
                        if mode in init_data["result"] and "actives" in init_data["result"][mode]:
                            for active_id_str, active_info in init_data["result"][mode]["actives"].items():
                                name = active_info.get("name", "")
                                if name.startswith("front."):
                                    name = name[6:]
                                try:
                                    OP_code.ACTIVES[name] = int(active_id_str)
                                except:
                                    pass
                logger.info(f"Dynamically patched OP_code.ACTIVES. Total assets loaded: {len(OP_code.ACTIVES)}")
            except Exception as e:
                logger.warning(f"Failed to dynamically patch OP_code.ACTIVES: {e}")
            # ------------------------------------

            api.change_balance(IQ_ACCOUNT_TYPE)
            # Retrieve balance safely from cache to prevent blocking hangs
            balance = 0.0
            try:
                from iqoptionapi.stable_api import global_value
                if api.api and api.api.profile and api.api.profile.balances:
                    for b in api.api.profile.balances:
                        if b.get("id") == global_value.balance_id:
                            balance = float(b.get("amount", 0.0))
                            break
                else:
                    balance = api.get_balance()
            except Exception:
                try:
                    balance = api.get_balance()
                except Exception:
                    pass
            logger.info(f"Current {IQ_ACCOUNT_TYPE} Account Balance: ${balance}")
            return api

        logger.warning(f"Attempt {attempt} failed: {reason}")
        if attempt < max_retries:
            delay = base_delay * (2 ** (attempt - 1))
            logger.info(f"Retrying in {delay}s...")
            time.sleep(delay)

    logger.error("All connection attempts exhausted.")
    return None

if __name__ == "__main__":
    # Test connection
    api_instance = connect_to_iqoption()
    if api_instance:
        print("Connection module works!")

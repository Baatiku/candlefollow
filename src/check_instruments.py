import logging
from connection import connect_to_iqoption

logging.basicConfig(level=logging.INFO)

api = connect_to_iqoption()
if api:
    print("Fetching digital option instruments...")
    try:
        instruments = api.get_instruments("digital-option")
        if instruments:
            for inst in instruments['instruments'][:5]:
                print(inst['active_id'], inst['name'])
        else:
            print("No digital instruments found.")
    except Exception as e:
        print("Error:", e)

"""
Market mixins for DoubleMartingaleBot.

Extraction order (see ARCHITECTURE_REFACTOR.md Steps 1.5–1.7):
  1.5  price_feed.py     — _install_price_sniffer, _price_data, _subscribe, _unsubscribe
  1.6  timing.py         — _wait_for_next_entry, _skip_to_next_entry_window, _server_second, _sync_clock
  1.7  asset_selector.py — auto_select_asset, list_tradeable_asset_symbols, asset penalty box
"""

FROM python:3.12-slim

WORKDIR /app

COPY scripts/hostex_dynamic_pricing.py scripts/hostex_pricing_config.json ./scripts/

CMD ["python3", "scripts/hostex_dynamic_pricing.py", "--apply"]

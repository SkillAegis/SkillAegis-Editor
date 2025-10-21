FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./

RUN apt-get update \
    && apt-get install -y --no-install-recommends jq \
    && apt-get purge -y --auto-remove \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /app/venv \
    && /app/venv/bin/pip install --upgrade pip setuptools \
    && /app/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

ENV VIRTUAL_ENV=/app/venv
ENV PATH="/app/venv/bin:${PATH}"
RUN cp config.py.sample config.py

EXPOSE 4001

CMD ["./start.sh"]

FROM python:3.13-slim
WORKDIR /app

# dumb-init: proper PID 1 signal handling for Python (equivalent of tini)
# gcc + build-essential: needed to compile some Python packages (pandas, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init gcc build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy vendor/ before pip install — requirements.txt has -e vendor/TradingAgents
# which needs the directory to exist at install time
COPY requirements.txt ./
COPY vendor/ ./vendor/
RUN pip install --no-cache-dir -r requirements.txt

# Create user before COPY so --chown works
RUN useradd -r -u 1001 -s /sbin/nologin finbot

COPY --chown=finbot:finbot src/ ./src/

USER finbot

EXPOSE 8000
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]

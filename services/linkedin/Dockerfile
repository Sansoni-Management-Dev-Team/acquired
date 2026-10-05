FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 ANONYMIZED_TELEMETRY=false BROWSER_USE_LOGGING_LEVEL=error
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd -m browser && mkdir /data && chown browser:browser /data
COPY *.py ./
USER browser
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log", "--log-level", "warning"]

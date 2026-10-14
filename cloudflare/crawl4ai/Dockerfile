FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip==26.2.0 && pip install --no-cache-dir -r requirements.txt && playwright install --with-deps chromium
COPY server.py .
EXPOSE 8080
CMD ["python", "server.py"]

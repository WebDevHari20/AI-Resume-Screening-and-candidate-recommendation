FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/data/huggingface
RUN mkdir -p /data/huggingface

CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

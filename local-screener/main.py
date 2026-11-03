import os
from functools import lru_cache

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer


MODEL_NAME = os.getenv("SBERT_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
SERVICE_TOKEN = os.getenv("SBERT_SERVICE_TOKEN", "").strip()
app = FastAPI(title="Resume screening SBERT service", version="1.0.0")


class RankRequest(BaseModel):
    resume_texts: list[str] = Field(min_length=1, max_length=1000)
    job_text: str = Field(min_length=1, max_length=12000)


class RankResponse(BaseModel):
    model: str
    scores: list[float]


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    return SentenceTransformer(MODEL_NAME)


def check_token(authorization: str | None) -> None:
    if SERVICE_TOKEN:
        expected = f"Bearer {SERVICE_TOKEN}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="Invalid service token")


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true", "model": MODEL_NAME}


@app.post("/rank", response_model=RankResponse)
def rank(
    request: RankRequest,
    authorization: str | None = Header(default=None),
) -> RankResponse:
    check_token(authorization)
    model = get_model()
    embeddings = model.encode(
        [request.job_text, *request.resume_texts],
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    scores = [float(embeddings[0] @ embedding) for embedding in embeddings[1:]]
    return RankResponse(model=MODEL_NAME, scores=scores)

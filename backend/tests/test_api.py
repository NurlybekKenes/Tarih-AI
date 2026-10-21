import unittest
import os
import tempfile
from pathlib import Path
import httpx
from unittest.mock import patch

from backend.app.main import app

async def request(method, path, **kwargs):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


class ApiTests(unittest.IsolatedAsyncioTestCase):
  @classmethod
  def setUpClass(cls):
    cls.temp_dir = tempfile.TemporaryDirectory()
    cls.previous_db_path = os.environ.get("TARIH_DATABASE_PATH")
    os.environ["TARIH_DATABASE_PATH"] = str(Path(cls.temp_dir.name) / "test.sqlite3")

  @classmethod
  def tearDownClass(cls):
    if cls.previous_db_path is None:
      os.environ.pop("TARIH_DATABASE_PATH", None)
    else:
      os.environ["TARIH_DATABASE_PATH"] = cls.previous_db_path
    cls.temp_dir.cleanup()

  async def test_health_and_seeded_events(self):
    self.assertEqual((await request("GET", "/health")).json()["status"], "ok")
    result = (await request("GET", "/api/events?language=kk")).json()
    self.assertGreaterEqual(result["total"], 2)
    self.assertTrue(all(item["title"] for item in result["items"]))
    self.assertTrue(any(item["slug"] == "abilai-khan-reign" for item in result["items"]))


  async def test_event_detail_search_and_404(self):
    detail = await request("GET", "/api/events/kazakhstan-independence?language=ru")
    self.assertEqual(detail.status_code, 200)
    self.assertTrue(detail.json()["sources"][0]["url"].startswith("https://"))
    self.assertEqual((await request("GET", "/api/search?q=Таңбалы&language=kk")).json()["total"], 1)
    abilai = await request("GET", "/api/events/abilai-khan-reign?language=ru")
    self.assertEqual(abilai.status_code, 200)
    self.assertEqual(abilai.json()["date_from"], "1771-01-01")
    self.assertEqual(len(abilai.json()["sources"]), 2)
    self.assertEqual((await request("GET", "/api/search?q=Абылай&language=kk")).json()["total"], 1)
    self.assertEqual((await request("GET", "/api/events/missing")).status_code, 404)


  async def test_versioned_api_periods_filters_and_pagination(self):
    periods = (await request("GET", "/api/v1/periods?language=kk")).json()["items"]
    self.assertGreaterEqual(len(periods), 3)
    self.assertTrue(all(item["title"] for item in periods))
    items = (await request("GET", "/api/v1/events?category=leadership&limit=1&offset=0")).json()
    self.assertEqual(items["total"], 1)
    self.assertEqual(items["items"][0]["slug"], "abilai-khan-reign")
    self.assertTrue(items["items"][0]["period_slug"])
    self.assertEqual((await request("GET", "/api/v1/search?q=Абылай&language=ru")).json()["total"], 1)


  async def test_event_catalog_contains_sourced_records(self):
    result = (await request("GET", "/api/v1/events?language=ru&limit=100")).json()
    self.assertEqual(result["total"], 10)
    self.assertTrue(all(item["sources"] for item in result["items"]))
    slugs = {item["slug"] for item in result["items"]}
    self.assertIn("yasawi-mausoleum", slugs)
    self.assertIn("kazakhstan-un-membership", slugs)


  async def test_document_import_full_text_search_and_chat_source(self):
    path = "/api/v1/documents/ablai-interview?filename=ablai-notes.md&language=ru"
    with patch.dict(os.environ, {"TARIH_ADMIN_TOKEN": ""}):
      disabled = await request("PUT", path, content="Материал", headers={"Content-Type": "text/markdown"})
    self.assertEqual(disabled.status_code, 503)
    with patch.dict(os.environ, {"TARIH_ADMIN_TOKEN": "test-admin-token"}):
      denied = await request("PUT", path, content="Материал", headers={"Content-Type": "text/markdown"})
      self.assertEqual(denied.status_code, 401)
      imported = await request("PUT", path, content="Абылай хан билік құрған 1771–1781 жылдар. Бұл редактор тексермеген құжат мәтіні.", headers={"Authorization": "Bearer test-admin-token", "Content-Type": "text/markdown"})
    self.assertEqual(imported.status_code, 201)
    self.assertGreater(imported.json()["chunks"], 0)
    results = (await request("GET", "/api/v1/search?q=Абылай&language=ru")).json()
    self.assertGreaterEqual(results["document_total"], 1)
    self.assertTrue(any(row["source_id"] == "user-doc:ablai-interview" for row in results["documents"]))
    with patch.dict(os.environ, {"TARIH_ADMIN_TOKEN": "test-admin-token", "LLM_BASE_URL": "", "LLM_API_KEY": "", "LLM_MODEL": ""}):
      answer = await request("POST", "/api/v1/chat", json={"question": "Абылай 1771", "language": "ru"})
    self.assertIn("user-doc:ablai-interview", {source["id"] for source in answer.json()["sources"]})
    self.assertTrue(any(not source["url"] for source in answer.json()["sources"]))


  async def test_chat_demo_sources_and_insufficient_data(self):
    demo_env = {"LLM_BASE_URL": "", "LLM_API_KEY": "", "LLM_MODEL": ""}
    with patch.dict(os.environ, demo_env):
      answer = (await request("POST", "/api/chat", json={"question": "Что произошло 16 декабря 1991 года?", "language": "ru"})).json()
    self.assertEqual(answer["mode"], "demo")
    self.assertTrue(answer["sources"] and all(source["url"].startswith("https://") for source in answer["sources"]))
    with patch.dict(os.environ, demo_env):
      abilai = (await request("POST", "/api/chat", json={"question": "Какие годы правил Абылай хан?", "language": "ru"})).json()
    self.assertEqual(abilai["mode"], "demo")
    self.assertFalse(abilai["insufficient_data"])
    self.assertIn("1771–1781", abilai["answer"])
    self.assertEqual(len(abilai["sources"]), 2)
    empty = (await request("POST", "/api/chat", json={"question": "Расскажи о вымышленной династии зета", "language": "ru"})).json()
    self.assertEqual(empty["sources"], [])
    self.assertIs(empty["insufficient_data"], True)


  async def test_chat_validates_question(self):
    self.assertEqual((await request("POST", "/api/chat", json={"question": "   ", "language": "ru"})).status_code, 422)
    self.assertEqual((await request("POST", "/api/chat", json={"question": "x" * 1001, "language": "ru"})).status_code, 422)


if __name__ == "__main__":
    unittest.main()

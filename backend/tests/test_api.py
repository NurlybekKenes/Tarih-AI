import unittest
import httpx

from backend.app.main import app

async def request(method, path, **kwargs):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


class ApiTests(unittest.IsolatedAsyncioTestCase):
  async def test_health_and_seeded_events(self):
    self.assertEqual((await request("GET", "/health")).json()["status"], "ok")
    result = (await request("GET", "/api/events?language=kk")).json()
    self.assertGreaterEqual(result["total"], 2)
    self.assertTrue(all(item["title"] for item in result["items"]))


  async def test_event_detail_search_and_404(self):
    detail = await request("GET", "/api/events/kazakhstan-independence?language=ru")
    self.assertEqual(detail.status_code, 200)
    self.assertTrue(detail.json()["sources"][0]["url"].startswith("https://"))
    self.assertEqual((await request("GET", "/api/search?q=Таңбалы&language=kk")).json()["total"], 1)
    self.assertEqual((await request("GET", "/api/events/missing")).status_code, 404)


  async def test_chat_demo_sources_and_insufficient_data(self):
    answer = (await request("POST", "/api/chat", json={"question": "Что произошло 16 декабря 1991 года?", "language": "ru"})).json()
    self.assertEqual(answer["mode"], "demo")
    self.assertTrue(answer["sources"] and all(source["url"].startswith("https://") for source in answer["sources"]))
    empty = (await request("POST", "/api/chat", json={"question": "Расскажи о вымышленной династии зета", "language": "ru"})).json()
    self.assertEqual(empty["sources"], [])
    self.assertIs(empty["insufficient_data"], True)


  async def test_chat_validates_question(self):
    self.assertEqual((await request("POST", "/api/chat", json={"question": "   ", "language": "ru"})).status_code, 422)
    self.assertEqual((await request("POST", "/api/chat", json={"question": "x" * 1001, "language": "ru"})).status_code, 422)


if __name__ == "__main__":
    unittest.main()

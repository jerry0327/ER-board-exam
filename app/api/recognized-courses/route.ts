import { getSemRecognitionFeed } from "../../lib/sem-recognized-courses.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const feed = await getSemRecognitionFeed();
  return Response.json(feed, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

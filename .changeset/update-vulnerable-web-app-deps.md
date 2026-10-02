---
"@scoutui/web-app": patch
---

Updates Next.js to 15.5.24, which fixes a critical remote code execution flaw in the image optimizer that could be reached without signing in, request forgery through rewrites and Server Actions, and a Server Actions denial of service. The dashboard image also moves to Auth.js core 0.41.3, which fixes a crash on malformed `Authorization` headers.

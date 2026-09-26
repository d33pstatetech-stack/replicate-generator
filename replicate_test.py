#!/usr/bin/env python3
"""
Replicate API smoke test — stdlib only, no SDK required.
Usage:
  set REPLICATE_API_TOKEN=<your-token-here>  (Windows)
  export REPLICATE_API_TOKEN=<your-token-here> (bash)
  python replicate_test.py

Override the pinned model with REPLICATE_VERSION=owner/name:version.
"""
import os, json, urllib.request, urllib.error, time

TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
# Pinned in client/src/models.js as the Flux LoRA wrapper entry, which exercises
# the richer input shape: two LoRA slots, go_fast, megapixels, and a
# disable_safety_checker toggle.
VERSION = os.environ.get(
    "REPLICATE_VERSION",
    "fofr/flux-pixar-cars:43768954c7bdc93d3bd0f01052652f8ce4e32781a37a7e832c048f7dc70b26bd",
)

payload = {
    "version": VERSION,
    "input": {
        "prompt": "a serene mountain landscape at sunrise, cinematic lighting, ultra detailed, 8k",
        "go_fast": True,
        "lora_scale": 1,
        "megapixels": "1",
        "num_outputs": 1,
        "aspect_ratio": "16:9",
        "output_format": "jpg",
        "guidance_scale": 3,
        "output_quality": 80,
        "num_inference_steps": 4,
        # Set False to re-enable the provider-side content filter. Left at the
        # same default the client applies when a model exposes the toggle.
        "disable_safety_checker": True,
    },
}

# Alternative using the replicate SDK (uncomment after `pip install replicate`):
# import replicate
# out = replicate.run(VERSION, input=payload["input"])
# print(out)

def main():
    if not TOKEN or TOKEN.startswith("<"):
        raise SystemExit("Set REPLICATE_API_TOKEN env var (see .dev.vars.example)")

    req = urllib.request.Request(
        "https://api.replicate.com/v1/predictions",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "Prefer": "wait"
        },
        method="POST"
    )
    print(f"POST https://api.replicate.com/v1/predictions  version={VERSION}")
    print(json.dumps(payload["input"], indent=2))
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.loads(resp.read().decode())
            print(f"\nHTTP {resp.status}  id={body.get('id')}  status={body.get('status')}")
            if body.get("output"):
                print("OUTPUT:", body["output"])
            if body.get("error"):
                print("ERROR:", body["error"])
            if body.get("logs"):
                print("--- logs tail ---\n", body["logs"][-800:])
            # if still processing, poll
            pred_id = body.get("id")
            while body.get("status") in ("starting","processing","queued"):
                time.sleep(2.5)
                greq = urllib.request.Request(f"https://api.replicate.com/v1/predictions/{pred_id}", headers={"Authorization": f"Bearer {TOKEN}"})
                with urllib.request.urlopen(greq, timeout=30) as gresp:
                    body = json.loads(gresp.read().decode())
                    print(f"  poll status={body.get('status')}")
                    if body.get("status") in ("succeeded","failed","canceled"):
                        print(json.dumps(body, indent=2)[:2000])
                        break
    except urllib.error.HTTPError as e:
        print(f"HTTPError {e.code}: {e.read().decode()[:2000]}")
        raise

if __name__ == "__main__":
    main()

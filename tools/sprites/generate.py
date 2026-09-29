"""Generate the rooftop cast with Krea 2 Turbo + a gouache style LoRA.

Usage:
  HF_TOKEN=... python tools/sprites/generate.py OUT_DIR [--backend space|fal] [--only a,b] [--seed 11] [--scale 1.25]
  python tools/sprites/cutout.py OUT_DIR public/sprites bear-read.png ...

Keep the whole cast on ONE backend in ONE pass: the fal provider and the
free krea/krea-lora-the-explorer Space apply the LoRA differently, so mixing
them gives mismatched styles. The Space uses free ZeroGPU quota (daily);
fal uses Hugging Face inference credits (monthly).
"""
import argparse, os, shutil, time
from pathlib import Path

MODEL = "ilkerzgi/krea-2-bold-gouache-urban-sketch-lora"
STYLE = ("Anthropomorphic animal character for a cozy lofi indie game, full body entirely in frame with space around it, "
         "chunky readable silhouette, confident dark ink outline, hand-painted gouache brushwork with visible strokes, "
         "soft sun-bleached pastel palette of peach, coral, lilac, butter yellow and sky blue, warm afternoon light. "
         "Isolated on a plain flat white paper background, no ground, no floor, no scenery, no shadow, no text. "
         "bold gouache urban sketch style")

CAST = {
    "bear-read": "A big friendly polar bear sitting cross-legged, reading a paperback book held in both paws, wearing a coral short-sleeved shirt and khaki shorts, sunglasses pushed up on his head",
    "bunny-paint": "A rabbit with long ears standing at a small wooden easel, painting a seascape with a brush, wearing a wide yellow straw sun hat and a lilac smock",
    "cat-stand": "A ginger tabby cat standing upright, holding a steaming coffee mug, wearing a cream knit sweater and blue jeans",
    "sheep-sit": "A fluffy white sheep sitting on the ground hugging its knees, eyes closed, wearing big over-ear headphones and a sky blue hoodie, peacefully listening to music",
    "fox-stand": "A slender red fox standing upright with hands in the pocket of a sage green hoodie, looking up at the sky, wearing a beanie",
    "frog-sit": "A plump green frog sitting on the ground playing a small ukulele, wearing a butter yellow bucket hat and a striped t-shirt",
    "raccoon-stand": "A raccoon standing upright watering a potted plant with a small tin watering can, wearing a peach apron over a white shirt",
    "bear-stand": "A stocky brown bear standing upright and stretching his arms up with a big yawn, wearing a red flannel shirt and grey trousers",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--backend", choices=["space", "fal"], default="space")
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--scale", type=float, default=1.25)
    args = ap.parse_args()
    token = os.environ["HF_TOKEN"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))

    if args.backend == "space":
        from gradio_client import Client
        client = Client("krea/krea-lora-the-explorer", token=token, verbose=False)
    else:
        from huggingface_hub import InferenceClient
        client = InferenceClient(provider="fal-ai", api_key=token)

    for name, subject in CAST.items():
        if only and name not in only:
            continue
        prompt = f"{subject}. {STYLE}"
        t = time.time()
        if args.backend == "space":
            path, _ = client.predict(prompt, MODEL, args.scale, 8, 0.0, 768, 1024, args.seed, False, api_name="/run_lora")
            shutil.copy(path, out / f"{name}.png")
        else:
            client.text_to_image(prompt, model=MODEL, width=768, height=1024, seed=args.seed).save(out / f"{name}.png")
        print(f"ok {name} {time.time() - t:.1f}s", flush=True)


if __name__ == "__main__":
    main()

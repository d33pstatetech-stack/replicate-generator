// Static model catalog for the Replicate Prompt Orchestrator React client.
// Extracted verbatim from public/index.html (CATALOG + referenced *_SCHEMA consts).
//
// Sourcing: STATIC — the worker has no /api/models endpoint (src/worker.js treats
// modelId as opaque; public/index.html line 1127 defines CATALOG in-page). The only
// model list the UI ever had is this in-page array, so the React port embeds it as a
// module instead of fetching. Schemas are Replicate-style JSON Schema
// ({ type, properties, required, defaults via property .default }).
//
// Counts: 15 models (CATALOG entries).
// FLUX LoRA wrapper (public Replicate model). Demonstrates the richer input
// shape: conditional width/height behind aspect_ratio=custom, go_fast / megapixels
// quantization, and two independent LoRA stacking slots (extra_lora plus
// replicate_weights). Schema mirrors the live upstream Input schema.
const FLUX_LORA_WRAPPER_SCHEMA = {"type":"object","title":"Input","required":["prompt"],"properties":{"mask":{"type":"string","title":"Mask","format":"uri","x-order":2,"description":"Image mask for image inpainting mode. If provided, aspect_ratio, width, and height inputs are ignored."},"seed":{"type":"integer","title":"Seed","x-order":11,"description":"Random seed. Set for reproducible generation"},"image":{"type":"string","title":"Image","format":"uri","x-order":1,"description":"Input image for image to image or inpainting mode. If provided, aspect_ratio, width, and height inputs are ignored."},"model":{"allOf":[{"$ref":"#/components/schemas/model"}],"default":"dev","x-order":7,"description":"Which model to run inference with. The dev model performs best with around 28 inference steps but the schnell model only needs 4 steps."},"width":{"type":"integer","title":"Width","maximum":1440,"minimum":256,"x-order":5,"description":"Width of generated image. Only works if `aspect_ratio` is set to custom. Will be rounded to nearest multiple of 16. Incompatible with fast generation"},"height":{"type":"integer","title":"Height","maximum":1440,"minimum":256,"x-order":4,"description":"Height of generated image. Only works if `aspect_ratio` is set to custom. Will be rounded to nearest multiple of 16. Incompatible with fast generation"},"prompt":{"type":"string","title":"Prompt","x-order":0,"description":"Prompt for generated image. If you include the `trigger_word` used in the training process you are more likely to activate the trained object, style, or concept in the resulting image."},"go_fast":{"type":"boolean","title":"Go Fast","default":false,"x-order":15,"description":"Run faster predictions with model optimized for speed (currently fp8 quantized); disable to run in original bf16"},"extra_lora":{"type":"string","title":"Extra Lora","x-order":19,"description":"Load LoRA weights. Supports Replicate models in the format <owner>/<username> or <owner>/<username>/<version>, HuggingFace URLs in the format huggingface.co/<owner>/<model-name>, CivitAI URLs in the format civitai.com/models/<id>[/<model-name>], or arbitrary .safetensors URLs from the Internet. For example, 'fofr/flux-pixar-cars'"},"lora_scale":{"type":"number","title":"Lora Scale","default":1,"maximum":3,"minimum":-1,"x-order":18,"description":"Determines how strongly the main LoRA should be applied. Sane results between 0 and 1 for base inference. For go_fast we apply a 1.5x multiplier to this value; we've generally seen good performance when scaling the base value by that amount. You may still need to experiment to find the best value for your particular lora."},"megapixels":{"allOf":[{"$ref":"#/components/schemas/megapixels"}],"default":"1","x-order":16,"description":"Approximate number of megapixels for generated image"},"num_outputs":{"type":"integer","title":"Num Outputs","default":1,"maximum":4,"minimum":1,"x-order":8,"description":"Number of outputs to generate"},"aspect_ratio":{"allOf":[{"$ref":"#/components/schemas/aspect_ratio"}],"default":"1:1","x-order":3,"description":"Aspect ratio for the generated image. If custom is selected, uses height and width below & will run in bf16 mode"},"output_format":{"allOf":[{"$ref":"#/components/schemas/output_format"}],"default":"webp","x-order":12,"description":"Format of the output images"},"guidance_scale":{"type":"number","title":"Guidance Scale","default":3,"maximum":10,"minimum":0,"x-order":10,"description":"Guidance scale for the diffusion process. Lower values can give more realistic images. Good values to try are 2, 2.5, 3 and 3.5"},"output_quality":{"type":"integer","title":"Output Quality","default":80,"maximum":100,"minimum":0,"x-order":13,"description":"Quality when saving the output images, from 0 to 100. 100 is best quality, 0 is lowest quality. Not relevant for .png outputs"},"prompt_strength":{"type":"number","title":"Prompt Strength","default":0.8,"maximum":1,"minimum":0,"x-order":6,"description":"Prompt strength when using img2img. 1.0 corresponds to full destruction of information in image"},"extra_lora_scale":{"type":"number","title":"Extra Lora Scale","default":1,"maximum":3,"minimum":-1,"x-order":20,"description":"Determines how strongly the extra LoRA should be applied. Sane results between 0 and 1 for base inference. For go_fast we apply a 1.5x multiplier to this value; we've generally seen good performance when scaling the base value by that amount. You may still need to experiment to find the best value for your particular lora."},"replicate_weights":{"type":"string","title":"Replicate Weights","x-order":17,"description":"Load LoRA weights. Supports Replicate models in the format <owner>/<username> or <owner>/<username>/<version>, HuggingFace URLs in the format huggingface.co/<owner>/<model-name>, CivitAI URLs in the format civitai.com/models/<id>[/<model-name>], or arbitrary .safetensors URLs from the Internet. For example, 'fofr/flux-pixar-cars'"},"num_inference_steps":{"type":"integer","title":"Num Inference Steps","default":28,"maximum":50,"minimum":1,"x-order":9,"description":"Number of denoising steps. More steps can give more detailed images, but take longer."},"disable_safety_checker":{"type":"boolean","title":"Disable Safety Checker","default":false,"x-order":14,"description":"Disable safety checker for generated images."}}};;

// Other model schemas — subsets/deltas to prove per-model validation matters.
const FLUX_SCHNELL_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",description:"Text prompt",x_order:0},
    aspect_ratio:{enum:["1:1","16:9","21:9","3:2","2:3","4:5","5:4","3:4","4:3","9:16"],type:"string",title:"aspect_ratio",description:"Aspect ratio",default:"1:1",x_order:1},
    num_outputs:{type:"integer",title:"Num Outputs",default:1,minimum:1,maximum:4,x_order:2},
    num_inference_steps:{type:"integer",title:"Steps",default:4,minimum:1,maximum:10,description:"schnell only needs 4 steps",x_order:3},
    guidance_scale:{type:"number",title:"Guidance",default:3,minimum:0,maximum:10,x_order:4},
    seed:{type:"integer",title:"Seed",x_order:5},
    output_format:{enum:["webp","jpg","png"],type:"string",title:"output_format",default:"webp",x_order:6},
    output_quality:{type:"integer",title:"Output Quality",default:80,minimum:0,maximum:100,x_order:7},
    disable_safety_checker:{type:"boolean",title:"Disable Safety Checker",default:true,description:"Bypass NSFW filter",x_order:8},
    go_fast:{type:"boolean",title:"Go Fast",default:true,description:"Always fast for schnell",x_order:9},
    megapixels:{enum:["1"],type:"string",title:"megapixels",default:"1",x_order:10}
  }
};

const SDXL_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0},
    negative_prompt:{type:"string",title:"Negative Prompt",description:"Things to avoid",x_order:1},
    width:{type:"integer",title:"Width",minimum:256,maximum:2048,default:1024,x_order:2,description:"SDXL supports up to 2048"},
    height:{type:"integer",title:"Height",minimum:256,maximum:2048,default:1024,x_order:3},
    num_outputs:{type:"integer",title:"Num Outputs",default:1,minimum:1,maximum:4,x_order:4},
    num_inference_steps:{type:"integer",title:"Steps",default:25,minimum:1,maximum:100,x_order:5},
    guidance_scale:{type:"number",title:"Guidance Scale",default:7.5,minimum:0,maximum:20,x_order:6},
    seed:{type:"integer",title:"Seed",x_order:7},
    scheduler:{enum:["DDIM","DPMSolverMultistep","HeunDiscrete","K_EULER","K_EULER_ANCESTRAL","PNDM"],type:"string",title:"Scheduler",default:"K_EULER",x_order:8},
    refine:{enum:["no_refiner","expert_ensemble_refiner","base_image_refiner"],type:"string",title:"Refine",default:"no_refiner",x_order:9},
    output_format:{enum:["webp","jpg","png"],type:"string",title:"output_format",default:"webp",x_order:10}
  }
};

const VIDEO_WAN_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Video prompt — describe motion"},
    image:{type:"string",format:"uri",title:"First Frame",description:"Optional first frame image (image-to-video)",x_order:1},
    duration:{type:"integer",title:"Duration (seconds)",default:5,minimum:1,maximum:10,x_order:2},
    aspect_ratio:{enum:["16:9","9:16","1:1"],type:"string",title:"Aspect Ratio",default:"16:9",x_order:3,description:"Video is locked to 720p / 1080p only — no custom"},
    resolution:{enum:["720p","1080p"],type:"string",title:"Resolution",default:"720p",x_order:4,description:"Valid resolutions for this model"},
    num_frames:{type:"integer",title:"Frames",default:81,minimum:16,maximum:200,x_order:5},
    guidance_scale:{type:"number",title:"Guidance",default:5,minimum:1,maximum:15,x_order:6},
    seed:{type:"integer",title:"Seed",x_order:7}
  }
};
const WAN22_T2V_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Prompt for video generation"},
    aspect_ratio:{enum:["16:9","9:16"],type:"string",title:"aspect_ratio",default:"16:9",x_order:1,description:"Aspect ratio 16:9 (832x480) or 9:16 (480x832)"},
    resolution:{enum:["480p"],type:"string",title:"resolution",default:"480p",x_order:2,description:"Resolution 480p only for 2.2 fast"},
    num_frames:{type:"integer",title:"Num Frames",default:81,minimum:81,maximum:121,x_order:3,description:"81 frames best, 121 max"},
    frames_per_second:{type:"integer",title:"Frames Per Second",default:16,minimum:5,maximum:30,x_order:4,description:"FPS, pricing based on 16fps duration"},
    sample_shift:{type:"number",title:"Sample Shift",default:12,minimum:1,maximum:20,x_order:5,description:"Sample shift factor"},
    go_fast:{type:"boolean",title:"Go Fast",default:true,x_order:6,description:"Go fast"},
    disable_safety_checker:{type:"boolean",title:"Disable Safety Checker",default:true,x_order:7,description:"Bypass NSFW filter — true for unrestricted"},
    seed:{type:"integer",title:"Seed",x_order:8,description:"Random seed"},
    optimize_prompt:{type:"boolean",title:"Optimize Prompt",default:false,x_order:9,description:"Translate prompt to Chinese"},
    interpolate_output:{type:"boolean",title:"Interpolate Output",default:true,x_order:10,description:"Interpolate to 30fps"}
  }
};
const WAN22_I2V_SCHEMA = {
  type:"object", title:"Input", required:["prompt","image"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Prompt for video generation"},
    image:{type:"string",format:"uri",title:"Image",x_order:1,description:"Input image to generate video from (required for I2V)"},
    last_image:{type:"string",format:"uri",title:"Last Image",x_order:2,description:"Optional last image for transition"},
    resolution:{enum:["480p"],type:"string",title:"resolution",default:"480p",x_order:3,description:"480p only"},
    num_frames:{type:"integer",title:"Num Frames",default:81,minimum:81,maximum:121,x_order:4,description:"81 frames best"},
    frames_per_second:{type:"integer",title:"Frames Per Second",default:16,minimum:5,maximum:30,x_order:5,description:"FPS"},
    sample_shift:{type:"number",title:"Sample Shift",default:12,minimum:1,maximum:20,x_order:6,description:"Sample shift"},
    go_fast:{type:"boolean",title:"Go Fast",default:true,x_order:7,description:"Go fast"},
    disable_safety_checker:{type:"boolean",title:"Disable Safety Checker",default:true,x_order:8,description:"Bypass NSFW filter"},
    seed:{type:"integer",title:"Seed",x_order:9,description:"Random seed"},
    interpolate_output:{type:"boolean",title:"Interpolate Output",default:false,x_order:10,description:"Interpolate to 30fps"}
  }
};
const WAVESPEED_WAN21_T2V_SCHEMA = {
  "type": "object",
  "title": "Input",
  "required": ["prompt","image"],
  "properties": {
    "seed": {"type": "integer", "title": "Seed", "x-order": 5, "nullable": true, "description": "Random seed. Set for reproducible generation"},
    "image": {"type": "string", "title": "Image", "format": "uri", "x-order": 3, "description": "Image for use as the initial frame of the video."},
    "prompt": {"type": "string", "title": "Prompt", "x-order": 0, "description": "Text prompt for image generation"},
    "fast_mode": {"enum": ["Off","Balanced","Fast"], "type": "string", "title": "fast_mode", "description": "Speed up generation with different levels of acceleration. Faster modes may degrade quality somewhat. The speedup is dependent on the content, so different videos may see different speedups.", "default": "Balanced", "x-order": 4},
    "lora_scale": {"type": "number", "title": "Lora Scale", "default": 1, "maximum": 4, "minimum": 0, "x-order": 10, "description": "Determines how strongly the main LoRA should be applied. Sane results between 0 and 1 for base inference. You may still need to experiment to find the best value for your particular lora."},
    "aspect_ratio": {"enum": ["16:9","9:16"], "type": "string", "title": "aspect_ratio", "description": "Aspect ratio of the output video.", "default": "16:9", "x-order": 2},
    "lora_weights": {"type": "string", "title": "Lora Weights", "x-order": 9, "nullable": true, "description": "Load LoRA weights. Supports HuggingFace URLs in the format huggingface.co/<owner>/<model-name>, CivitAI URLs in the format civitai.com/models/<id>[/<model-name>], or arbitrary .safetensors URLs from the Internet."},
    "sample_shift": {"type": "integer", "title": "Sample Shift", "default": 3, "maximum": 10, "minimum": 0, "x-order": 8, "description": "Flow shift parameter for video generation"},
    "sample_steps": {"type": "integer", "title": "Sample Steps", "default": 30, "maximum": 40, "minimum": 1, "x-order": 7, "description": "Number of inference steps"},
    "negative_prompt": {"type": "string", "title": "Negative Prompt", "default": "", "x-order": 1, "description": "Negative prompt to avoid certain elements"},
    "sample_guide_scale": {"type": "number", "title": "Sample Guide Scale", "default": 5, "maximum": 10, "minimum": 1, "x-order": 6, "description": "Guidance scale for generation"},
    "disable_safety_checker": {"type": "boolean", "title": "Disable Safety Checker", "default": false, "x-order": 11, "description": "Disable safety checker for generated videos"}
  }
};

// WaveSpeed Wan 2.1 I2V 480p — live schema (2026-09-11), version e2870aa4.
// lora_weights takes docs-format huggingface.co/owner/repo or direct .safetensors URLs.
const WAVESPEED_WAN21_I2V_480P_SCHEMA = {
  type:"object", title:"Input", required:["prompt","image"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Text prompt for image generation"},
    negative_prompt:{type:"string",title:"Negative Prompt",default:"",x_order:1,description:"Negative prompt to avoid certain elements"},
    aspect_ratio:{enum:["16:9","9:16"],type:"string",title:"aspect_ratio",default:"16:9",x_order:2,description:"Aspect ratio of the output video."},
    image:{type:"string",format:"uri",title:"Image",x_order:3,description:"Image for use as the initial frame of the video."},
    fast_mode:{enum:["Off","Balanced","Fast"],type:"string",title:"fast_mode",default:"Balanced",x_order:4,description:"Speed up generation with different levels of acceleration. Faster modes may degrade quality somewhat."},
    seed:{type:"integer",title:"Seed",x_order:5,description:"Random seed. Set for reproducible generation"},
    sample_guide_scale:{type:"number",title:"Sample Guide Scale",default:5,minimum:1,maximum:10,x_order:6,description:"Guidance scale for generation"},
    sample_steps:{type:"integer",title:"Sample Steps",default:30,minimum:1,maximum:40,x_order:7,description:"Number of inference steps"},
    sample_shift:{type:"integer",title:"Sample Shift",default:3,minimum:0,maximum:10,x_order:8,description:"Flow shift parameter for video generation"},
    lora_weights:{type:"string",title:"Lora Weights",x_order:9,nullable:true,description:"Load LoRA weights. Supports HuggingFace URLs in the format huggingface.co/<owner>/<model-name>, CivitAI URLs in the format civitai.com/models/<id>[/<model-name>], or arbitrary .safetensors URLs from the Internet."},
    lora_scale:{type:"number",title:"Lora Scale",default:1,minimum:0,maximum:4,x_order:10,description:"Determines how strongly the main LoRA should be applied. Sane results between 0 and 1."},
    disable_safety_checker:{type:"boolean",title:"Disable Safety Checker",default:false,x_order:11,description:"Disable safety checker for generated videos"}
  }
};

// WaveSpeed Wan 2.1 I2V 720p — live schema (2026-09-11), version 1f0a7fa0.
// Same inputs as 480p at higher resolution.
const WAVESPEED_WAN21_I2V_720P_SCHEMA = {
  type:"object", title:"Input", required:["prompt","image"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Text prompt for image generation"},
    negative_prompt:{type:"string",title:"Negative Prompt",default:"",x_order:1,description:"Negative prompt to avoid certain elements"},
    aspect_ratio:{enum:["16:9","9:16"],type:"string",title:"aspect_ratio",default:"16:9",x_order:2,description:"Aspect ratio of the output video."},
    image:{type:"string",format:"uri",title:"Image",x_order:3,description:"Image for use as the initial frame of the video."},
    fast_mode:{enum:["Off","Balanced","Fast"],type:"string",title:"fast_mode",default:"Balanced",x_order:4,description:"Speed up generation with different levels of acceleration. Faster modes may degrade quality somewhat."},
    seed:{type:"integer",title:"Seed",x_order:5,description:"Random seed. Set for reproducible generation"},
    sample_guide_scale:{type:"number",title:"Sample Guide Scale",default:5,minimum:1,maximum:10,x_order:6,description:"Guidance scale for generation"},
    sample_steps:{type:"integer",title:"Sample Steps",default:30,minimum:1,maximum:40,x_order:7,description:"Number of inference steps"},
    sample_shift:{type:"integer",title:"Sample Shift",default:3,minimum:0,maximum:10,x_order:8,description:"Flow shift parameter for video generation"},
    lora_weights:{type:"string",title:"Lora Weights",x_order:9,nullable:true,description:"Load LoRA weights. Supports HuggingFace URLs in the format huggingface.co/<owner>/<model-name>, CivitAI URLs in the format civitai.com/models/<id>[/<model-name>], or arbitrary .safetensors URLs from the Internet."},
    lora_scale:{type:"number",title:"Lora Scale",default:1,minimum:0,maximum:4,x_order:10,description:"Determines how strongly the main LoRA should be applied. Sane results between 0 and 1."},
    disable_safety_checker:{type:"boolean",title:"Disable Safety Checker",default:false,x_order:11,description:"Disable safety checker for generated videos"}
  }
};

// wan-video/wan2.1-with-lora — live schema (2026-09-11), version c48fa8ec.
// Wan 2.1 14b/1.3b T2V+I2V with lora_url + separate model/CLIP strength sliders.
const WAN21_WITH_LORA_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Text prompt for video generation"},
    negative_prompt:{type:"string",title:"Negative Prompt",default:"",x_order:1,description:"Things you do not want to see in your video"},
    image:{type:"string",format:"uri",title:"Image",x_order:2,nullable:true,description:"Image to use as a starting frame for image to video generation."},
    aspect_ratio:{enum:["16:9","9:16","1:1"],type:"string",title:"aspect_ratio",default:"16:9",x_order:3,description:"The aspect ratio of the video."},
    frames:{enum:[17,33,49,65,81],type:"integer",title:"Frames",default:81,x_order:4,description:"The number of frames to generate (1 to 5 seconds)"},
    model:{enum:["1.3b","14b"],type:"string",title:"Model",default:"14b",x_order:5,description:"The model to use. 1.3b is faster, but 14b is better quality. Use 14b for 14B LoRAs."},
    resolution:{enum:["480p","720p"],type:"string",title:"Resolution",default:"480p",x_order:6,description:"The resolution of the video. 720p is not supported for 1.3b."},
    lora_url:{type:"string",title:"Lora URL",x_order:7,nullable:true,description:"Optional: the URL of a LoRA to use (HF resolve .safetensors URL)."},
    lora_strength_model:{type:"number",title:"Lora Strength Model",default:1,x_order:8,description:"Strength of the LoRA applied to the model. 0.0 is no LoRA."},
    lora_strength_clip:{type:"number",title:"Lora Strength Clip",default:1,x_order:9,description:"Strength of the LoRA applied to the CLIP model. 0.0 is no LoRA."},
    fast_mode:{enum:["Off","Balanced","Fast"],type:"string",title:"fast_mode",default:"Balanced",x_order:10,description:"Speed up generation with different levels of acceleration."},
    sample_steps:{type:"integer",title:"Sample Steps",default:30,minimum:1,maximum:60,x_order:11,description:"Number of generation steps. Fewer steps means faster generation."},
    sample_guide_scale:{type:"number",title:"Sample Guide Scale",default:5,minimum:0,maximum:10,x_order:12,description:"Higher guide scale makes prompt adherence better, but can reduce variation"},
    sample_shift:{type:"number",title:"Sample Shift",default:8,minimum:0,maximum:10,x_order:13,description:"Sample shift factor"},
    seed:{type:"integer",title:"Seed",x_order:14,description:"Set a seed for reproducibility. Random by default."}
  }
};

// WAN 3.0 — live schema from alibaba/wan-3 + wan-3-prime (2026-08-24), resolved from openapi_schema Input
// wan3-llms.txt in replicate_docs: alibaba/wan-3 supports 480p/720p/1080p, adaptive + 16:9/9:16/1:1/4:3/3:4, duration 2-30, image I2V optional
const WAN3_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Text prompt for video generation — cinematic motion, 2-30s. Tip: be descriptive about scene, lighting, camera movement."},
    image:{type:"string",format:"uri",title:"Image",x_order:1,description:"Optional first-frame image to animate into a video (jpg/png/bmp/webp, ≤10MB). When provided, the video is generated from this image guided by the prompt. Aspect ratio is then ignored."},
    negative_prompt:{type:"string",title:"Negative Prompt",default:"",x_order:2,description:"Content that should not appear — e.g. blurry, distorted, low quality, static."},
    resolution:{enum:["480p","720p","1080p"],type:"string",title:"resolution",default:"1080p",x_order:3,description:"Output resolution. Pricing per second: 480p $0.05 · 720p $0.10 · 1080p $0.20 (50% off on wan-3 until Aug 30)."},
    aspect_ratio:{enum:["adaptive","16:9","9:16","1:1","4:3","3:4"],type:"string",title:"aspect_ratio",default:"adaptive",x_order:4,description:"'adaptive' lets the model choose best ratio for prompt. Ignored when image is provided (input image ratio is used)."},
    duration:{type:"integer",title:"Duration",default:5,minimum:2,maximum:30,x_order:5,description:"Duration in seconds (2-30). Longer = more cinematic but pricier."},
    enable_prompt_expansion:{type:"boolean",title:"Enable Prompt Expansion",default:true,x_order:6,description:"Automatically expand and optimize short prompts for better results (adds latency)."},
    seed:{type:"integer",title:"Seed",x_order:7,description:"Random seed 0-2147483647 for reproducible generation. Leave empty for random."}
  }
};
const WAN3_PRIME_SCHEMA = JSON.parse(JSON.stringify(WAN3_SCHEMA)); // same params as base; prime is speed-optimized variant

const KREA_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Text prompt describing the image."},
    aspect_ratio:{enum:["1:1","16:9","3:2","2:3","4:5","3:4","9:16"],type:"string",title:"aspect_ratio",default:"1:1",x_order:1,description:"Aspect ratio of the generated image."},
    creativity:{enum:["raw","low","medium","high"],type:"string",title:"creativity",default:"medium",x_order:2,description:"How far the model expands on your prompt."},
    style_reference_images:{type:"array", items:{type:"string",format:"uri"}, title:"Style Reference Images", default:[], x_order:3,description:"Up to 10 reference images whose style should be transferred."},
    style_reference_strength:{type:"number",title:"Style Reference Strength",default:0.5,minimum:0,maximum:1,x_order:4,description:"How strongly to apply style."},
    moodboard_id:{type:"string",title:"Moodboard Id",default:null,x_order:5,description:"Optional Krea moodboard UUID."},
    moodboard_strength:{type:"number",title:"Moodboard Strength",default:0.35,minimum:0,maximum:1,x_order:6,description:"How strongly moodboard shapes output."},
    seed:{type:"integer",title:"Seed",x_order:7,description:"Random seed. Leave blank for random."}
  }
};
const QWEN_IMAGE_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Prompt for generated image"},
    enhance_prompt:{type:"boolean",title:"Enhance Prompt",default:false,x_order:1,description:"Enhance the prompt with positive magic."},
    lora_weights:{type:"string",format:"uri",title:"Lora Weights",x_order:2,nullable:true,description:"Load LoRA weights. Supports arbitrary .safetensors URLs, tar files, and zip files (e.g. https://huggingface.co/.../resolve/main/*.safetensors). T2I pipeline only."},
    replicate_weights:{type:"string",format:"uri",title:"Replicate Weights",x_order:3,nullable:true,description:"Load LoRA weights from Replicate training. T2I pipeline only."},
    lora_scale:{type:"number",title:"Lora Scale",default:1,x_order:4,description:"Determines how strongly the main LoRA should be applied."},
    extra_lora_weights:{type:"array",items:{type:"string",format:"uri"},title:"Extra Lora Weights",x_order:5,nullable:true,description:"Additional LoRA weights as an array of URLs, one per line."},
    extra_lora_scale:{type:"array",items:{type:"number"},title:"Extra Lora Scale",x_order:6,nullable:true,description:"Scales for additional LoRAs. Must match the number of extra_lora_weights."},
    image:{type:"string",format:"uri",title:"Image",x_order:7,description:"Input image for img2img pipeline"},
    strength:{type:"number",title:"Strength",default:0.9,minimum:0,maximum:1,x_order:8,description:"Strength for img2img pipeline"},
    negative_prompt:{type:"string",title:"Negative Prompt",default:" ",x_order:9,description:"Negative prompt for generated image"},
    aspect_ratio:{enum:["1:1","16:9","9:16","4:3","3:4","3:2","2:3"],type:"string",title:"aspect_ratio",default:"16:9",x_order:10,description:"Aspect ratio for the generated image"},
    image_size:{enum:["optimize_for_quality","optimize_for_speed"],type:"string",title:"image_size",default:"optimize_for_quality",x_order:11,description:"Image size for the generated image"},
    go_fast:{type:"boolean",title:"Go Fast",default:true,x_order:12,description:"Run faster predictions with additional optimizations."},
    num_inference_steps:{type:"integer",title:"Num Inference Steps",default:30,minimum:1,maximum:50,x_order:13,description:"Number of denoising steps. Recommended 28-50."},
    guidance:{type:"number",title:"Guidance",default:3,minimum:0,maximum:10,x_order:14,description:"Guidance for generated image."},
    seed:{type:"integer",title:"Seed",x_order:15,description:"Random seed. Set for reproducible generation"},
    output_format:{enum:["webp","jpg","png"],type:"string",title:"output_format",default:"webp",x_order:16,description:"Format of the output images"},
    output_quality:{type:"integer",title:"Output Quality",default:80,minimum:0,maximum:100,x_order:17,description:"Quality 0-100. Not relevant for .png"},
    disable_safety_checker:{type:"boolean",title:"Disable Safety Checker",default:true,description:"Bypass NSFW filter",x_order:18}
  }
};

// minimax/h3 — OFFICIAL versionless model (schema from /minimax/h3/llms.txt, 2026-09-12).
// T2V + first/last-frame I2V + reference (up to 9 images / 3 videos / 3 audio). 4-15s, 768P/2K.
// Billing: $0.08/s @768P, $0.13/s @2K. Called WITHOUT a version pin:
// POST /v1/models/minimax/h3/predictions {input}. No LoRA slots, no safety
// toggle (moderation is MiniMax-side) — keep schema exact so buildInput sends nothing spurious.
const H3_SCHEMA = {
  type:"object", title:"Input", required:["prompt"],
  properties:{
    prompt:{type:"string",title:"Prompt",x_order:0,description:"Text prompt describing the video"},
    first_frame_image:{type:"string",format:"uri",title:"First Frame Image",x_order:1,description:"Optional first frame — output follows its aspect ratio (I2V)"},
    last_frame_image:{type:"string",format:"uri",title:"Last Frame Image",x_order:2,description:"Optional last frame — final frame matches it"},
    reference_image_urls:{type:"array",items:{type:"string",format:"uri"},title:"Reference Images",default:[],x_order:3,description:"Up to 9 reference images (character/style consistency)"},
    reference_video_urls:{type:"array",items:{type:"string",format:"uri"},title:"Reference Videos",default:[],x_order:4,description:"Up to 3 reference videos (motion/camera/rhythm guide)"},
    reference_audio_urls:{type:"array",items:{type:"string",format:"uri"},title:"Reference Audio",default:[],x_order:5,description:"Up to 3 reference audio clips (voice/rhythm guide)"},
    duration:{type:"integer",title:"Duration (s)",default:5,minimum:4,maximum:15,x_order:6,description:"4-15s. Billed per second: $0.08/s 768P, $0.13/s 2K"},
    resolution:{enum:["768P","2K"],type:"string",title:"Resolution",default:"768P",x_order:7,description:"768P cheap / 2K premium"},
    ratio:{enum:["adaptive","16:9","9:16","1:1","4:3","3:4","21:9"],type:"string",title:"Aspect Ratio",default:"adaptive",x_order:8,description:"REQUIRED for text-to-video (pick a concrete ratio). Use adaptive with first_frame_image"}
  }
};

const CATALOG = [
  { id:"fofr/flux-pixar-cars", name:"FLUX Pixar Cars (LoRA wrapper)", group:"image", category:"Image · Flux LoRA", version:"fofr/flux-pixar-cars:43768954c7bdc93d3bd0f01052652f8ce4e32781a37a7e832c048f7dc70b26bd", description:"Public FLUX LoRA wrapper — good reference for the richer input shape: conditional width/height behind aspect_ratio=custom (max 1440), go_fast / megapixels quantization, and two LoRA slots (extra_lora plus replicate_weights).", schema: FLUX_LORA_WRAPPER_SCHEMA },
  { id:"black-forest-labs/flux-schnell", name:"FLUX.1 [schnell]", group:"image", category:"Image · FLUX", version:"black-forest-labs/flux-schnell:c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e", description:"Speed-optimized FLUX — 4 steps is enough. Latest 2025-06-25.", schema: FLUX_SCHNELL_SCHEMA },
  { id:"black-forest-labs/flux-dev", name:"FLUX.1 [dev]", group:"image", category:"Image · FLUX", version:"black-forest-labs/flux-dev:6e4a938f85952bdabcc15aa329178c4d681c52bf25a0342403287dc26944661d", description:"Quality FLUX — ~28 steps. Latest.", schema: (()=>{ const s=JSON.parse(JSON.stringify(FLUX_SCHNELL_SCHEMA)); s.properties.num_inference_steps.default=28; s.properties.num_inference_steps.maximum=50; s.properties.go_fast.default=false; s.properties.megapixels.enum=["1","0.25"]; return s;})() },
  { id:"krea/krea-2-large", name:"Krea 2 Large", group:"image", category:"Image · Krea", version:"krea/krea-2-large:eef77a68a7699844a7c324d8c2a1a158b84a77b7c1875ecb3eb0c1fbc16570a9", description:"Krea flagship — photorealism. Use style_reference_images for style transfer; load adapters for the Krea family from a Hugging Face URL.", schema: KREA_SCHEMA },
  { id:"stability-ai/sdxl", name:"SDXL", group:"image", category:"Image · Stable Diffusion", version:"stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc", description:"1024px SDXL — width/height up to 2048, latest 7762fd07.", schema: SDXL_SCHEMA },
  { id:"qwen/qwen-image", name:"Qwen-Image (LoRA-capable)", group:"image", category:"Image · Qwen", version:"qwen/qwen-image:0bba9e70f78437359725e0989ead45ca8b09e6c12a070dfe9a09e6856b43a44d", description:"Qwen-Image with lora_weights / extra_lora_weights slots — Replicate-side target for Qwen-Image LoRAs. T2I pipeline only for LoRA.", schema: QWEN_IMAGE_SCHEMA },
  { id:"alibaba/wan-3", name:"WAN 3.0", group:"video", category:"Video · WAN 3.0", version:"alibaba/wan-3:bb8bf2a1273cabad48e6c566ad7112e06bbc6ccf39684ffd81b618822735f056", description:"Alibaba Wan 3.0 — text-to-video + image-to-video, cinematic motion, 480p/720p/1080p, 2-30s, adaptive or 16:9/9:16/1:1/4:3/3:4. 50% off until Aug 30. From replicate_docs/wan3-llms.txt + live API.", schema: WAN3_SCHEMA },
  { id:"alibaba/wan-3-prime", name:"WAN 3.0 Prime", group:"video", category:"Video · WAN 3.0", version:"alibaba/wan-3-prime:736267d3620794f7e744f46c814304617a16ff3d19e43ee70daa7bff87c7d150", description:"Wan 3.0 Prime — speed-optimized variant of Wan 3.0, same params (prompt, image, resolution, aspect_ratio, duration 2-30, prompt expansion). Up to 1080p/30s.", schema: WAN3_PRIME_SCHEMA },
  { id:"wan-video/wan-2.2-t2v-fast", name:"WAN 2.2 T2V Fast", group:"video", category:"Video · WAN", version:"wan-video/wan-2.2-t2v-fast:c483b1f7b892065bc58ebadb6381abf557f6b1f517d2ff0febb3fb635cf49b4d", description:"Wan 2.2 T2V Fast — text-to-video, 480p 16:9/9:16, 81-121 frames, 5-30fps. For image-to-video use WAN 2.2 I2V Fast or WAN 3.0.", schema: WAN22_T2V_SCHEMA },
  { id:"wan-video/wan-2.2-i2v-fast", name:"WAN 2.2 I2V Fast", group:"video", category:"Video · WAN", version:"wan-video/wan-2.2-i2v-fast:4eaf2b01d3bf70d8a2e00b219efeb7cb415855ad18b7dacdc4cae664a73a6eea", description:"Wan 2.2 I2V Fast — image-to-video, supports image + last_image, 480p, 81 frames. Fixed: was wan-2.1-t2v-14b (Model not found).", schema: WAN22_I2V_SCHEMA },
  { id:"wavespeedai/wan-2.1-i2v-480p", name:"WAN 2.1 I2V 480p (WaveSpeed)", group:"video", category:"Video · WAN", version:"wavespeedai/wan-2.1-i2v-480p:e2870aa4965fd9ddfd87c16a3c8ab952c18e745e63f3f3b123c2dc8b538ad2b5", description:"WaveSpeed Wan 2.1 I2V 480p — lora_weights (docs-format HF/CivitAI URLs) + safety toggle. LoRA target for Wan 2.1 I2V 480P adapters. Note: WaveSpeed may still block explicit outputs provider-side even with NSFW enabled (observed 2026-09-11).", schema: WAVESPEED_WAN21_I2V_480P_SCHEMA },
  { id:"wavespeedai/wan-2.1-i2v-720p", name:"WAN 2.1 I2V 720p (WaveSpeed)", group:"video", category:"Video · WAN", version:"wavespeedai/wan-2.1-i2v-720p:1f0a7fa066689a087b597a314f60ef74d1a720fa1fb9a7083487c4b01db3395f", description:"WaveSpeed Wan 2.1 I2V 720p — lora_weights (docs-format HF/CivitAI URLs) + safety toggle. LoRA target for Wan 2.1 I2V 720P adapters. Note: WaveSpeed may still block explicit outputs provider-side even with NSFW enabled (observed 2026-09-11).", schema: WAVESPEED_WAN21_I2V_720P_SCHEMA },
  { id:"wan-video/wan2.1-with-lora", name:"Wan 2.1 with LoRA", group:"video", category:"Video · WAN", version:"wan-video/wan2.1-with-lora:c48fa8ec65b13143cb552ab98ea17984eab9d70e9fe99479117de40a2a7f9ed0", description:"Wan 2.1 14b/1.3b T2V+I2V with lora_url + model/CLIP strength sliders. Use 14b for 14B LoRAs.", schema: WAN21_WITH_LORA_SCHEMA },
  { id:"wavespeedai/wan-2.1-t2v-480p", name:"WAVESPEED Wan 2.1 T2V 480p", group:"video", category:"Video · Wavespeed", version:"wavespeedai/wan-2.1-t2v-480p:7677a619127ea34d1ed873fb5b77448e4b9889fbd83809b44a2c459ace99192a", description:"WavespeedAI Wan 2.1 T2V 480p — I2V (image required) + T2V, 16:9/9:16, fast_mode Off/Balanced/Fast, sample_steps 1-40, lora_scale 0-4, disable_safety_checker for unrestricted.", schema: WAVESPEED_WAN21_T2V_SCHEMA },
  { id:"minimax/h3", name:"MiniMax H3 (I2V + reference)", group:"video", category:"Video · Hailuo", version:"minimax/h3", official:true, description:"MiniMax H3 official — T2V + first/last-frame I2V + reference (9 imgs / 3 vids / 3 audio), 4-15s, 768P/2K ($0.08/$0.13 per s). Official model: runs latest, no version pin. No LoRA slots; moderation is MiniMax-side.", schema: H3_SCHEMA },
];

// ─── Module interface ───
// Normalized for the shared picker components: `group_of` aliases the
// catalog's `group` field, and `cost` is always 0 (Replicate pricing is
// per-model/per-second on replicate.com — the catalog carries none).
export const MODELS = CATALOG.map((m) => ({ ...m, group_of: m.group, cost: 0 }));

export function getModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

export function getSchema(id) {
  const m = getModel(id);
  return m ? m.schema : null;
}

// Defaults come from each property's `.default` (Replicate-style schema).
export function schemaDefaults(schema) {
  const d = {};
  for (const [k, s] of Object.entries(schema?.properties || {})) {
    if (s && s.default !== undefined) d[k] = s.default;
  }
  return d;
}

// Submission routing per public/index.html generate() (line ~1868):
// official versionless models run latest via the model endpoint (body {input}),
// otherwise the version pin (body {version, input}) or model alias ({model, input}).
export function submitRoute(model) {
  if (!model) return { path: '/api/replicate/predictions', body: (input) => ({ input }) };
  if (model.official) {
    return { path: `/api/replicate/models/${model.id}/predictions`, body: (input) => ({ input }) };
  }
  if (model.version && model.version.includes(':')) {
    return { path: '/api/replicate/predictions', body: (input) => ({ version: model.version, input }) };
  }
  return { path: '/api/replicate/predictions', body: (input) => ({ model: model.id, input }) };
}

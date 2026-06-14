import { tool } from '@opencode-ai/plugin';

const VLM_ENDPOINT = process.env.VLM_API_URL || 'http://127.0.0.1:8082/v1/chat/completions';

function toResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function createMantaVisionTool() {
  return tool({
    description: 'Read images/screenshots using local VLM (GLM-4.6V-Flash). You CAN see images. Pass a file path to any image and this tool will read and describe its contents including error messages, UI text, code, etc.',
    args: {
      imagePath: tool.schema.string().describe('Absolute path to image file'),
      prompt: tool.schema.string().optional().describe('Custom prompt for VLM analysis'),
    },
    execute: async (args: { imagePath: string; prompt?: string }) => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const imagePath = args.imagePath;
      const prompt = args.prompt || 'What is shown in this image? Return the exact text visible.';

      if (!fs.existsSync(imagePath)) {
        return toResult({ status: 'error', message: `File not found: ${imagePath}` });
      }

      const ext = path.extname(imagePath).toLowerCase();
      const supported = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      if (!supported.includes(ext)) {
        return toResult({ status: 'error', message: `Unsupported format: ${ext}. Supported: ${supported.join(', ')}` });
      }

      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.replace('.', '')}`;

      const payload = JSON.stringify({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        }],
        max_tokens: 2048,
        temperature: 0.1,
      });

      // Try up to 2 times
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await fetch(VLM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(120000),
          });

          if (!response.ok) {
            const text = await response.text().catch(() => '');
            return toResult({ 
              status: 'error', 
              message: `VLM HTTP ${response.status}: ${text.slice(0, 200)}` 
            });
          }

          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content;

          if (content && typeof content === 'string' && content.length > 0) {
            return toResult({
              status: 'ok',
              imagePath,
              content,
              model: data?.model || 'GLM-4.6V-Flash',
              usage: data?.usage || {},
            });
          }

          // Empty response - retry once after 2s
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }

          // Second attempt failed - return debug info
          return toResult({ 
            status: 'error', 
            message: 'VLM returned empty content after 2 attempts',
            debug: { 
              responseKeys: Object.keys(data || {}),
              hasChoices: !!data?.choices,
              choicesLength: data?.choices?.length || 0,
              hasMessage: !!(data?.choices?.[0]?.message),
              contentType: typeof data?.choices?.[0]?.message?.content,
              contentLength: data?.choices?.[0]?.message?.content?.length || 0,
              rawPreview: JSON.stringify(data).slice(0, 500),
            }
          });
        } catch (error: unknown) {
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          const err = error instanceof Error ? error : new Error(String(error));
          const errMsg = err.message || String(error);
          return toResult({ status: 'error', message: `VLM failed after 2 attempts: ${errMsg}` });
        }
      }
    },
  });
}

// Converte um .glb com texturas WebP embutidas num .gltf com texturas JPEG em arquivos ao lado.
// Motivo: o GLTFLoader lê textura embutida por fetch() de uma URL blob: (sujeita à CSP e a falhas
// silenciosas) e o WebP entra como extensão obrigatória. Como arquivos comuns, o navegador busca
// as imagens como qualquer outra do site e guarda em cache.
//
//   node externalize.ts ../../client/public/models/realista-1.glb ../../client/public/models/realista-1.gltf
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { basename } from 'node:path';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath || !outPath.endsWith('.gltf')) {
  console.error('uso: node externalize.ts <entrada.glb> <saida.gltf>');
  process.exit(1);
}
const stem = basename(outPath, '.gltf');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
for (const tex of doc.getRoot().listTextures()) {
  const name = tex.getName() || 'tex';
  const isNormal = /normal/i.test(name);
  // Cor base: JPEG comum. Normal map: sem subamostragem de croma, para não distorcer as normais.
  const jpeg = await sharp(tex.getImage()!).jpeg({ quality: isNormal ? 92 : 86, chromaSubsampling: isNormal ? '4:4:4' : '4:2:0', mozjpeg: true }).toBuffer();
  tex.setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg').setURI(`${stem}-${name}.jpg`);
  console.log(`${name}: ${(tex.getImage()!.byteLength / 1024).toFixed(0)} KB`);
}
for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
doc.getRoot().listBuffers().forEach((b) => b.setURI(`${stem}.bin`));
await io.write(outPath, doc);
console.log(`gravado ${outPath}`);

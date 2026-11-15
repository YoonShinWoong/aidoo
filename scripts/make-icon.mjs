// Small code-drawn application mark. No image generation or extra build dependencies.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
const n = 512
const bg = [23, 23, 23], fg = [255, 255, 255], dot = [255, 255, 255]
function roundedRect(x, y, cx, cy, w, h, r) {
  const dx = Math.max(Math.abs(x-cx) - (w/2-r), 0)
  const dy = Math.max(Math.abs(y-cy) - (h/2-r), 0)
  return dx*dx + dy*dy <= r*r && Math.abs(x-cx) <= w/2 && Math.abs(y-cy) <= h/2
}
function pixel(x,y) {
  if (!roundedRect(x,y,256,256,496,496,112)) return [0,0,0,0]
  let c = bg
  const radius = Math.hypot(x-238,y-286)
  if ((radius < 104 && radius > 52) || roundedRect(x,y,318,286,52,208,26)) c = fg
  if (Math.hypot(x-338,y-145)<25) c = dot
  return [...c,255]
}
const raw = Buffer.alloc((n*4+1)*n)
for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
  const sum=[0,0,0,0]
  for(const sy of [.25,.75]) for(const sx of [.25,.75]) pixel(x+sx,y+sy).forEach((v,i)=>sum[i]+=v/4)
  sum.forEach((v,i)=>raw[y*(n*4+1)+1+x*4+i]=Math.round(v))
}
function crc(buf) {
  let c=0xffffffff
  for(const v of buf){ c^=v; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0) }
  return (c^0xffffffff)>>>0
}
function chunk(type,data) {
  const name=Buffer.from(type), len=Buffer.alloc(4), check=Buffer.alloc(4)
  len.writeUInt32BE(data.length); check.writeUInt32BE(crc(Buffer.concat([name,data])))
  return Buffer.concat([len,name,data,check])
}
const header=Buffer.alloc(13);header.writeUInt32BE(n,0);header.writeUInt32BE(n,4);header[8]=8;header[9]=6
mkdirSync('assets',{recursive:true})
writeFileSync('assets/icon.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]))

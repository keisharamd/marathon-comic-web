import { lookup } from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
const baseAllowedHosts = ["komiku.org","komiku.cc","komiku.net","komiku.to","komiku.site","komiku.online"];
const extraHosts = (process.env.SOURCE_HOSTS ?? "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
export const allowedHosts = [...new Set([...baseAllowedHosts,...extraHosts])];
export function isAllowedHost(hostname:string):boolean {
 const host=hostname.toLowerCase().replace(/^\[|\]$/g,"").replace(/\.$/,"");
 if(net.isIP(host)||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")) return false;
 return allowedHosts.some(allowed=>host===allowed||host.endsWith("."+allowed));
}
export const sourceUrlSchema=z.string().trim().url().max(2048).superRefine((raw,ctx)=>{
 let u:URL; try{u=new URL(raw)}catch{ctx.addIssue({code:"custom",message:"URL tidak valid."});return}
 if(!["http:","https:"].includes(u.protocol))ctx.addIssue({code:"custom",message:"Hanya HTTP/HTTPS yang diizinkan."});
 if(u.username||u.password)ctx.addIssue({code:"custom",message:"URL dengan kredensial tidak diizinkan."});
 if(!isAllowedHost(u.hostname))ctx.addIssue({code:"custom",message:"Domain sumber belum diizinkan."});
 if(u.port&&!["80","443"].includes(u.port))ctx.addIssue({code:"custom",message:"Port non-standar tidak diizinkan."});
});
function private4(ip:string){const p=ip.split(".").map(Number);if(p.length!==4||p.some(x=>!Number.isInteger(x)||x<0||x>255))return true;const[a,b]=p;return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19));}
function private6(ip:string){const x=ip.toLowerCase().split("%")[0];if(x==="::"||x==="::1"||x.startsWith("fc")||x.startsWith("fd")||/^fe[89ab]/.test(x))return true;if(x.startsWith("::ffff:")&&net.isIP(x.slice(7))===4)return private4(x.slice(7));return false;}
export async function assertPublicDestination(url:URL):Promise<void>{
 if(!isAllowedHost(url.hostname))throw new Error("Host tujuan tidak diizinkan.");
 const records=net.isIP(url.hostname)?[{address:url.hostname,family:net.isIP(url.hostname)}]:await lookup(url.hostname,{all:true,verbatim:true}).catch(()=>[]);
 if(!records.length)throw new Error("Domain sumber tidak dapat di-resolve.");
 for(const r of records){if(r.family===4?private4(r.address):private6(r.address))throw new Error("Akses ke IP privat atau khusus diblokir.");}
}
export function parseSourceUrl(value:unknown):URL{const p=sourceUrlSchema.safeParse(value);if(!p.success)throw new Error(p.error.issues[0]?.message??"URL sumber tidak valid.");return new URL(p.data);}

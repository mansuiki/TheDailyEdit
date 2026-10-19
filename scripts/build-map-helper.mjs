import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
if(process.platform!=='darwin')throw Error('The Apple Maps helper requires macOS.');
fs.mkdirSync('.runtime',{recursive:true,mode:0o700});
execFileSync('swiftc',['native/RouteReader.swift','-o','.runtime/RouteReader','-framework','MapKit','-framework','AppKit'],{stdio:'inherit'});
console.log('Apple Maps route helper built. It uses entered addresses, never device location.');

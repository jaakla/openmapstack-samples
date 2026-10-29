import fs from 'node:fs';
import { WalkingRouter } from '../src/walking.js';
const [graphPath,stopPath,outputPath]=process.argv.slice(2);
const graph=JSON.parse(fs.readFileSync(graphPath)),stops=JSON.parse(fs.readFileSync(stopPath));
const router=new WalkingRouter(graph,stops);
const transfers=stops.map((s,i)=>router.nearby(s,600).filter(p=>p.stop!==i).map(p=>[p.stop,Math.max(1,p.seconds),p.metres,p.coordinates]));
fs.writeFileSync(outputPath,JSON.stringify({transfers,snapped:router.stopIds.filter(x=>x!==null).length,links:transfers.reduce((n,x)=>n+x.length,0)}));
console.log(`Pedestrian network: ${graph.vertices.length} vertices, ${graph.edges.length} edges; ${router.stopIds.filter(x=>x!==null).length}/${stops.length} platforms snapped.`);

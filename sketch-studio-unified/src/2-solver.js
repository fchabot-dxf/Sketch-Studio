import { getDist, projectPointOnSegment, projectPointOnLine } from './1-utils.js';
// Iterative relaxation solver; mutates joint positions in-place
export function solveConstraints(joints, shapes, constraints, iter=20){
  for(let k=0;k<iter;k++){
    for(const c of constraints){
      if(c.type==='coincident'){
        const a=joints.get(c.joints[0]), b=joints.get(c.joints[1]); if(!a||!b) continue;
        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2; if(!a.fixed){ a.x=mx; a.y=my; } if(!b.fixed){ b.x=mx; b.y=my; }
      }
      else if(c.type==='horizontal'){
        const a=joints.get(c.joints[0]), b=joints.get(c.joints[1]); if(!a||!b) continue; const my=(a.y+b.y)/2; if(!a.fixed) a.y=my; if(!b.fixed) b.y=my;
      }
      else if(c.type==='vertical'){
        const a=joints.get(c.joints[0]), b=joints.get(c.joints[1]); if(!a||!b) continue; const mx=(a.x+b.x)/2; if(!a.fixed) a.x=mx; if(!b.fixed) b.x=mx;
      }
      else if(c.type==='distance'){
        const a=joints.get(c.joints[0]), b=joints.get(c.joints[1]); if(!a||!b) continue; const dx=b.x-a.x, dy=b.y-a.y; let d=Math.hypot(dx,dy); if(d<1e-6) continue; const target=c.value; const err=(d-target)/d*0.5; if(!a.fixed){ a.x+=dx*err; a.y+=dy*err; } if(!b.fixed){ b.x-=dx*err; b.y-=dy*err; }
      }
      else if(c.type==='parallel' || c.type==='perpendicular'){
        // Handle both shape-based (newer) and joint-based (legacy) constraints
        let a, b, p, q;
        
        if(c.shapes && c.shapes.length >= 2){
          // Shape-based: find joints from shape IDs
          const s1 = shapes.find(s => s.id === c.shapes[0]);
          const s2 = shapes.find(s => s.id === c.shapes[1]);
          if(!s1 || !s2 || !s1.joints || !s2.joints || s1.joints.length < 2 || s2.joints.length < 2) continue;
          a = joints.get(s1.joints[0]);
          b = joints.get(s1.joints[1]);
          p = joints.get(s2.joints[0]);
          q = joints.get(s2.joints[1]);
        } else if(c.joints && c.joints.length >= 4){
          // Joint-based (legacy)
          a = joints.get(c.joints[0]);
          b = joints.get(c.joints[1]);
          p = joints.get(c.joints[2]);
          q = joints.get(c.joints[3]);
        } else {
          continue;
        }
        
        if(!a||!b||!p||!q) continue;
        const refAng=Math.atan2(b.y-a.y,b.x-a.x); 
        let targetAng;
        if(c.type==='parallel'){
          targetAng = refAng;
        } else {
          // Perpendicular: choose +90° or -90° based on which is closer to current angle
          const currentAng = Math.atan2(q.y-p.y, q.x-p.x);
          const option1 = refAng + Math.PI/2;
          const option2 = refAng - Math.PI/2;
          // Normalize angle differences to [-π, π]
          const diff1 = Math.atan2(Math.sin(option1 - currentAng), Math.cos(option1 - currentAng));
          const diff2 = Math.atan2(Math.sin(option2 - currentAng), Math.cos(option2 - currentAng));
          targetAng = Math.abs(diff1) < Math.abs(diff2) ? option1 : option2;
        }
        const len=Math.hypot(q.x-p.x,q.y-p.y)||1; const cx=(p.x+q.x)/2, cy=(p.y+q.y)/2; if(!p.fixed){ p.x = cx - Math.cos(targetAng)*len*0.5; p.y = cy - Math.sin(targetAng)*len*0.5; } if(!q.fixed){ q.x = cx + Math.cos(targetAng)*len*0.5; q.y = cy + Math.sin(targetAng)*len*0.5; }
      }
      else if(c.type==='pointOnLine'){
        // Project point onto line
        const shape = shapes.find(s => s.id === c.shape);
        if(!shape || !shape.joints || shape.joints.length < 2) continue;
        const pt = joints.get(c.joint);
        const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
        if(!pt || !a || !b) continue;
        if(pt.fixed) continue;
        const proj = projectPointOnSegment(pt, a, b);
        // Move point toward projection
        pt.x = pt.x + (proj.x - pt.x) * 0.5;
        pt.y = pt.y + (proj.y - pt.y) * 0.5;
      }
      else if(c.type==='collinear'){
        // Forces 3 or more joints to lie on the same line
        if(!c.joints || c.joints.length < 3) continue;
        const pts = c.joints.map(id => joints.get(id)).filter(j => j);
        if(pts.length < 3) continue;
        
        // Use first two points to define the line
        const p0 = pts[0], p1 = pts[1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy);
        if(len < 1e-6) continue;
        
        // Project remaining points onto the line defined by p0-p1
        for(let i = 2; i < pts.length; i++){
          const pt = pts[i];
          if(pt.fixed) continue;
          const proj = projectPointOnLine(pt, p0, p1);
          pt.x = pt.x + (proj.x - pt.x) * 0.5;
          pt.y = pt.y + (proj.y - pt.y) * 0.5;
        }
      }
      else if(c.type==='tangent'){
        // Line tangent to circle
        if(!c.line || !c.circle) continue;
        const lineShape = shapes.find(s => s.id === c.line);
        const circleShape = shapes.find(s => s.id === c.circle);
        if(!lineShape || !circleShape || lineShape.type !== 'line' || circleShape.type !== 'circle') continue;
        
        const a = joints.get(lineShape.joints[0]);
        const b = joints.get(lineShape.joints[1]);
        const center = joints.get(circleShape.joints[0]);
        const radiusPt = joints.get(circleShape.joints[1]);
        if(!a || !b || !center || !radiusPt) continue;
        
        const radius = getDist(center, radiusPt);
        // Project center onto line and ensure distance equals radius
        const proj = projectPointOnSegment(center, a, b);
        const dist = getDist(center, proj);
        const error = dist - radius;
        
        if(Math.abs(error) > 1e-3){
          // Move line points perpendicular to line to adjust distance
          const dx = b.x - a.x, dy = b.y - a.y;
          const lineLen = Math.hypot(dx, dy);
          if(lineLen < 1e-6) continue;
          const nx = -dy / lineLen, ny = dx / lineLen; // Normal vector
          const adjust = error * 0.5;
          if(!a.fixed){ a.x += nx * adjust; a.y += ny * adjust; }
          if(!b.fixed){ b.x += nx * adjust; b.y += ny * adjust; }
        }
      }
    }
  }
}

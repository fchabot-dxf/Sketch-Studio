import { solveConstraints } from './2-solver.js';
import { findSnap as snapFind, hitJointAtScreen as snapHit } from './3-snap.js';

// Embedded store (was store.js)
const joints = new Map();
const shapes = [];
const constraints = [];
let jid = 0;
function _genJ(){ return 'j'+(++jid)+'_'+Date.now(); }
function _initStore(){ joints.clear(); shapes.length = 0; constraints.length = 0; jid = 0; joints.set('j_origin',{x:0,y:0,fixed:true}); }

export function createEngine(svg){
  function init(){ _initStore(); }
  function genJ(){ return _genJ(); }
  function getJoints(){ return joints; }
  function getShapes(){ return shapes; }
  function getConstraints(){ return constraints; }
  function addJoint(id,x,y,fixed=false){ joints.set(id,{x,y,fixed}); }
  function addShape(shape){ shapes.push(shape); }
  function addConstraint(c){ constraints.push(c); }
  function mergeJoints(fromId,toId){ if(!joints.has(fromId)||!joints.has(toId)||fromId===toId) return; for(const s of shapes){ for(let i=0;i<s.joints.length;i++) if(s.joints[i]===fromId) s.joints[i]=toId; } joints.delete(fromId); }
  function solve(iter=20){ solveConstraints(joints, shapes, constraints, iter); }
  function findSnap(lastMouse){ return snapFind(joints, shapes, svg, lastMouse); }
  function hitJointAtScreen(screenX,screenY,threshold=10){ return snapHit(joints, svg, screenX, screenY, threshold); }

  return { init, genJ, getJoints, getShapes, getConstraints, addJoint, addShape, addConstraint, mergeJoints, solve, findSnap, hitJointAtScreen };
}

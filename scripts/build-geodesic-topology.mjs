import { writeFile } from "node:fs/promises";
import * as THREE from "three";

const detail = 39;
const output = new URL("../public/projects/enso/geodesic-39.bin", import.meta.url);

function buildDualGeodesicUnits() {
  const source = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const sourcePositions = source.getAttribute("position");
  const vertices = [];
  const vertexMap = new Map();
  const faces = [];
  const edgeMap = new Map();

  for (let index = 0; index < sourcePositions.count; index += 3) {
    const ids = [0, 1, 2].map((offset) => {
      const point = new THREE.Vector3(sourcePositions.getX(index + offset), sourcePositions.getY(index + offset), sourcePositions.getZ(index + offset)).normalize();
      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
      if (!vertexMap.has(key)) {
        vertexMap.set(key, vertices.length);
        vertices.push({ normal: point, faces: [] });
      }
      return vertexMap.get(key);
    });
    const center = new THREE.Vector3().add(vertices[ids[0]].normal).add(vertices[ids[1]].normal).add(vertices[ids[2]].normal).normalize();
    const faceIndex = faces.length;
    faces.push({ center });
    ids.forEach((id) => vertices[id].faces.push(faceIndex));
    [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]].forEach(([a, b]) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const entry = edgeMap.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
      entry.faces.push(faceIndex);
      edgeMap.set(key, entry);
    });
  }

  const units = vertices.map((vertex, id) => {
    const normal = vertex.normal;
    const reference = Math.abs(normal.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const boundary = vertex.faces.map((faceIndex) => faces[faceIndex].center)
      .sort((a, b) => Math.atan2(a.dot(bitangent), a.dot(tangent)) - Math.atan2(b.dot(bitangent), b.dot(tangent)));
    return { id, boundary, lat: Math.asin(normal.y) * 180 / Math.PI, lon: Math.atan2(normal.x, normal.z) * 180 / Math.PI };
  }).filter((unit) => unit.boundary.length >= 5);

  const unitIds = new Set(units.map((unit) => unit.id));
  const edges = [...edgeMap.values()].filter((edge) => unitIds.has(edge.a) && unitIds.has(edge.b) && edge.faces.length === 2)
    .map((edge) => ({ a: edge.a, b: edge.b, ends: edge.faces.map((faceIndex) => faces[faceIndex].center) }));
  return { units, edges };
}

const { units, edges } = buildDualGeodesicUnits();
const unitBytes = 88;
const edgeBytes = 32;
const buffer = Buffer.allocUnsafe(16 + units.length * unitBytes + edges.length * edgeBytes);
let offset = 0;
buffer.writeUInt32LE(0x4b494754, offset); offset += 4;
buffer.writeUInt32LE(1, offset); offset += 4;
buffer.writeUInt32LE(units.length, offset); offset += 4;
buffer.writeUInt32LE(edges.length, offset); offset += 4;
for (const unit of units) {
  buffer.writeUInt32LE(unit.id, offset); offset += 4;
  buffer.writeUInt8(unit.boundary.length, offset); offset += 4;
  buffer.writeFloatLE(unit.lat, offset); offset += 4;
  buffer.writeFloatLE(unit.lon, offset); offset += 4;
  for (let index = 0; index < 6; index += 1) {
    const point = unit.boundary[Math.min(index, unit.boundary.length - 1)];
    buffer.writeFloatLE(point.x, offset); offset += 4;
    buffer.writeFloatLE(point.y, offset); offset += 4;
    buffer.writeFloatLE(point.z, offset); offset += 4;
  }
}
for (const edge of edges) {
  buffer.writeUInt32LE(edge.a, offset); offset += 4;
  buffer.writeUInt32LE(edge.b, offset); offset += 4;
  for (const point of edge.ends) {
    buffer.writeFloatLE(point.x, offset); offset += 4;
    buffer.writeFloatLE(point.y, offset); offset += 4;
    buffer.writeFloatLE(point.z, offset); offset += 4;
  }
}
await writeFile(output, buffer);
console.log(`${units.length} units, ${edges.length} edges, ${buffer.length} bytes`);

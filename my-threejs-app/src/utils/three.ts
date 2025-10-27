import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'

export function createScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x20252b)
  scene.fog = new THREE.FogExp2(0x20252b, 0.015)
  return scene
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 300)
  camera.position.set(4, 3, 6)
  return camera
}

export function createRenderer(mount: HTMLDivElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  mount.appendChild(renderer.domElement)
  return renderer
}

export function createControls(camera: THREE.Camera, dom: HTMLCanvasElement) {
  const controls = new OrbitControls(camera as THREE.PerspectiveCamera, dom)
  controls.enableDamping = true
  controls.target.set(0, 0.5, 0)
  controls.update()
  return controls
}

export function addHelpers(scene: THREE.Scene) {
  scene.add(new THREE.GridHelper(400, 80, 0x444444, 0x303030))
}

export function createGround(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(500, 500)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x245f38,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  scene.add(mesh)
  return { geo, mat, mesh }
}

export function createRectangle(scene: THREE.Scene) {
  const geo = new THREE.BoxGeometry(0.5, 1, 2)
  const edges = new THREE.EdgesGeometry(geo)
  const mat = new THREE.LineBasicMaterial({ color: 0x9ecaff, depthWrite: false })
  const line = new THREE.LineSegments(edges, mat)
  line.position.y = 0.505
  line.name = 'MainBox' // added for tests
  scene.add(line)
  return { geo, edges, mat, line }
}

export function createLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223311, 0.5))
  const dir = new THREE.DirectionalLight(0xffffff, 1)
  dir.position.set(5, 10, 5)
  dir.castShadow = true
  dir.shadow.mapSize.set(2048, 2048)
  dir.shadow.camera.near = 1
  dir.shadow.camera.far = 40
  dir.shadow.camera.left = -15
  dir.shadow.camera.right = 15
  dir.shadow.camera.top = 15
  dir.shadow.camera.bottom = -15
  scene.add(dir)
  return dir
}

export function createNoise(scene: THREE.Scene, enabled: boolean) {
  if (!enabled) return { points: null, update: () => {}, dispose: () => {} }

  const pointCount = 2500
  const geo = new THREE.BufferGeometry()
  const arr = new Float32Array(pointCount * 3)
  for (let i = 0; i < pointCount; i++) {
    const ix = i * 3
    arr[ix] = (Math.random() - 0.5) * 200
    arr[ix + 1] = Math.random() * 0.05 + 0.02
    arr[ix + 2] = (Math.random() - 0.5) * 200
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.25,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
  })
  const points = new THREE.Points(geo, mat)
  scene.add(points)

  const update = () => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    for (let j = 0; j < 200; j++) {
      const idx = Math.floor(Math.random() * pointCount) * 3
      pos.array[idx] += (Math.random() - 0.5) * 0.4
      pos.array[idx + 1] += (Math.random() - 0.5) * 0.1
      pos.array[idx + 2] += (Math.random() - 0.5) * 0.4
    }
    pos.needsUpdate = true
  }

  const dispose = () => {
    geo.dispose()
    mat.dispose()
    scene.remove(points)
  }

  return { points, update, dispose }
}

export function resizeRenderer(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
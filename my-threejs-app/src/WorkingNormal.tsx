import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import './App.css'

function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const hasInitialized = useRef(false)

  useEffect(() => {
    if (!mountRef.current || hasInitialized.current) return
    hasInitialized.current = true

    // Camera
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 300)
    camera.position.set(4, 3, 6)

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x20252b)
    scene.fog = new THREE.FogExp2(0x20252b, 0.015)

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mountRef.current.appendChild(renderer.domElement)

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.5, 0)
    controls.update()

    // Helpers
    scene.add(new THREE.AxesHelper(3))
    scene.add(new THREE.GridHelper(400, 80, 0x444444, 0x303030))

    // Ground
    const groundGeo = new THREE.PlaneGeometry(500, 500)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x245f38,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    // Box (hollow wireframe)
    const boxGeo = new THREE.BoxGeometry(0.5, 1, 2)
    const boxEdges = new THREE.EdgesGeometry(boxGeo)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x9ecaff, depthWrite: false })
    const rectangle = new THREE.LineSegments(boxEdges, edgeMat)
    rectangle.position.y = 0.505
    scene.add(rectangle)

    if (import.meta.env.MODE === 'development' || process.env.NODE_ENV === 'test') {
      console.log("Exposing box for testing...");
      (window as any).testingBox = rectangle;
    }
    // Lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223311, 0.5))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1)
    dirLight.position.set(5, 10, 5)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.set(2048, 2048)
    dirLight.shadow.camera.near = 1
    dirLight.shadow.camera.far = 40
    dirLight.shadow.camera.left = -15
    dirLight.shadow.camera.right = 15
    dirLight.shadow.camera.top = 15
    dirLight.shadow.camera.bottom = -15
    scene.add(dirLight)

    // Key handling (discrete moves)
    const down: Record<string, boolean> = {}
    const step = 0.5

    const centerOnRectangle = () => {
      // Translate camera + target by same world delta so orientation stays the same
      const delta = new THREE.Vector3().subVectors(rectangle.position, controls.target)
      camera.position.add(delta)
      controls.target.add(delta)
      // No rotation change; just update controls
      controls.update()
    }

    const moveOnce = (k: string) => {
      switch (k) {
        case 'w': rectangle.position.z -= step; break
        case 's': rectangle.position.z += step; break
        case 'a': rectangle.position.x -= step; break
        case 'd': rectangle.position.x += step; break
        case 'c': centerOnRectangle(); break
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (down[k]) return
      down[k] = true
      moveOnce(k)
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      down[e.key.toLowerCase()] = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // Animation
    const animate = () => {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      hasInitialized.current = false
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      controls.dispose()
      renderer.dispose()
      boxGeo.dispose(); boxEdges.dispose(); edgeMat.dispose()
      groundGeo.dispose(); groundMat.dispose()
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement)
      }
    }
  }, [])

  return <div ref={mountRef} style={{ width: '100vw', height: '100vh' }} />
}

export default App
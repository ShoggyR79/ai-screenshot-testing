import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import './App.css'

// MUI
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  Tooltip
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import VisibilityIcon from '@mui/icons-material/Visibility'

const DRAWER_WIDTH = 300

function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const hasInitialized = useRef(false)

  const generateRandomInfo = () =>
    Array.from({ length: 8 }, (_, i) => {
      const seed = Math.random().toString(36).slice(2, 8)
      return `Item ${i + 1}: ${seed} • val ${(Math.random() * 100).toFixed(2)}`
    })

  const [open, setOpen] = useState(true)
  const [randomInfo, setRandomInfo] = useState<string[]>(generateRandomInfo())

  const refreshInfo = () => setRandomInfo(generateRandomInfo())
  const toggleDrawer = () => setOpen(o => !o)

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
    renderer.setPixelRatio(window.devicePixelRatio)
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
      ;(window as any).testingBox = rectangle
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
      const delta = new THREE.Vector3().subVectors(rectangle.position, controls.target)
      camera.position.add(delta)
      controls.target.add(delta)
      controls.update()
    }

    const moveOnce = (k: string) => {
      switch (k) {
        case 'w': rectangle.position.z -= step; break
        case 's': rectangle.position.z += step; break
        case 'a': rectangle.position.x -= step; break
        case 'd': rectangle.position.x += step; break
        case 'c': centerOnRectangle(); break
        case ']': toggleDrawer(); break
        case 'r': refreshInfo(); break
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (down[k]) return
      down[k] = true
      moveOnce(k)
    }
    const handleKeyUp = (e: KeyboardEvent) => { down[e.key.toLowerCase()] = false }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // Random noise point cloud (forces visual diffs)
    const pointCount = 2500
    const noiseGeo = new THREE.BufferGeometry()
    const noisePositions = new Float32Array(pointCount * 3)
    for (let i = 0; i < pointCount; i++) {
      const ix = i * 3
      noisePositions[ix] = (Math.random() - 0.5) * 200
      noisePositions[ix + 1] = Math.random() * 0.05 + 0.02
      noisePositions[ix + 2] = (Math.random() - 0.5) * 200
    }
    noiseGeo.setAttribute('position', new THREE.BufferAttribute(noisePositions, 3))
    const noiseMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.25,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    })
    const noisePoints = new THREE.Points(noiseGeo, noiseMat)
    scene.add(noisePoints)

    // Animation
    const animate = () => {
      requestAnimationFrame(animate)
      const pos = noiseGeo.getAttribute('position') as THREE.BufferAttribute
      for (let j = 0; j < 200; j++) {
        const idx = Math.floor(Math.random() * pointCount) * 3
        pos.array[idx] += (Math.random() - 0.5) * 0.4
        pos.array[idx + 1] += (Math.random() - 0.5) * 0.1
        pos.array[idx + 2] += (Math.random() - 0.5) * 0.4
      }
      pos.needsUpdate = true
      camera.position.x += (Math.random() - 0.5) * 0.002
      camera.position.y += (Math.random() - 0.5) * 0.002
      camera.position.z += (Math.random() - 0.5) * 0.002
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

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
      noiseGeo.dispose(); noiseMat.dispose()
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <Box sx={{ display: 'flex' }}>
      <Box
        ref={mountRef}
        style={{
          width: open ? `calc(100vw - ${DRAWER_WIDTH}px)` : '100vw',
          height: '100vh',
          transition: 'width 0.25s ease'
        }}
      />
      <Drawer
        variant="persistent"
        anchor="right"
        open={open}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', background: '#1f262c', color: '#e8f4ff' }
        }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Random Info</Typography>
          <Tooltip title="Refresh (R)">
            <IconButton size="small" onClick={refreshInfo} color="primary">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Toggle (])">
            <IconButton size="small" onClick={toggleDrawer} color="primary">
              <VisibilityIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <List dense>
          {randomInfo.map((line, idx) => (
            <ListItem key={idx}>
              <ListItemText
                primary={line}
                primaryTypographyProps={{ fontSize: 13, fontFamily: 'monospace' }}
              />
            </ListItem>
          ))}
        </List>
        <Box sx={{ mt: 'auto', p: 2, fontSize: 11, opacity: 0.6 }}>
          Hotkeys: W A S D move • C center • R refresh • ] toggle drawer
        </Box>
      </Drawer>
    </Box>
  )
}

export default App
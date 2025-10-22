import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import './App.css'
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  Tooltip,
  Switch,
  FormControlLabel
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import VisibilityIcon from '@mui/icons-material/Visibility'
import ShuffleIcon from '@mui/icons-material/Shuffle'

import {
  createScene,
  createCamera,
  createRenderer,
  createControls,
  addHelpers,
  createGround,
  createRectangle,
  createLights,
  createNoise,
  resizeRenderer
} from './utils/three'

const DRAWER_WIDTH = 300
const initialRandomness = import.meta.env.VITE_RANDOMNESS !== 'false'

function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const hasInitialized = useRef(false)

  // Scene refs
  const sceneRef = useRef<THREE.Scene>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera>(null)
  const rendererRef = useRef<THREE.WebGLRenderer>(null)
  const controlsRef = useRef<any>(null)
  const rectangleRef = useRef<THREE.LineSegments>(null)
  const noiseCtxRef = useRef<{
    points: THREE.Points | null
    update: () => void
    dispose: () => void
  }>(null)

  // UI state
  const [open, setOpen] = useState(true)
  const [randomInfo, setRandomInfo] = useState<string[]>(generateRandomInfo())
  const [randomness, setRandomness] = useState<boolean>(initialRandomness)

  function generateRandomInfo() {
    return Array.from({ length: 8 }, (_, i) => {
      const seed = Math.random().toString(36).slice(2, 8)
      return `Item ${i + 1}: ${seed} • val ${(Math.random() * 100).toFixed(2)}`
    })
  }
  const refreshInfo = () => setRandomInfo(generateRandomInfo())
  const toggleDrawer = () => setOpen(o => !o)
  const toggleRandomness = () => setRandomness(r => !r)

  // Movement
  const step = 0.5
  const keyDownMap: Record<string, boolean> = {}

  useEffect(() => {
    if (!mountRef.current || hasInitialized.current) return
    hasInitialized.current = true

    // Build world
    const scene = (sceneRef.current = createScene())
    const camera = (cameraRef.current = createCamera())
    const renderer = (rendererRef.current = createRenderer(mountRef.current))
    const controls = (controlsRef.current = createControls(camera, renderer.domElement))
    addHelpers(scene)
    const ground = createGround(scene)
    const rectangle = createRectangle(scene)
    rectangleRef.current = rectangle.line
    const lights = createLights(scene)

    // Noise (random)
    noiseCtxRef.current = createNoise(scene, randomness)

    if (import.meta.env.MODE === 'development' || process.env.NODE_ENV === 'test') {
      ;(window as any).testingBox = rectangle.line
    }

    // Hotkeys
    const centerOnRectangle = () => {
      const rect = rectangleRef.current
      if (!rect) return
      const delta = new THREE.Vector3().subVectors(rect.position, controls.target)
      camera.position.add(delta)
      controls.target.add(delta)
      controls.update()
    }

    const moveOnce = (k: string) => {
      const rect = rectangleRef.current
      if (!rect) return
      switch (k) {
        case 'w': rect.position.z -= step; break
        case 's': rect.position.z += step; break
        case 'a': rect.position.x -= step; break
        case 'd': rect.position.x += step; break
        case 'c': centerOnRectangle(); break
        case ']': toggleDrawer(); break
        case 'r': refreshInfo(); break
        case 'n': toggleRandomness(); break
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (keyDownMap[k]) return
      keyDownMap[k] = true
      moveOnce(k)
    }
    const handleKeyUp = (e: KeyboardEvent) => { keyDownMap[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // Animate
    const animate = () => {
      requestAnimationFrame(animate)

      // Randomness effects (noise + slight camera jitter)
      if (randomness) {
        noiseCtxRef.current?.update()
        camera.position.x += (Math.random() - 0.5) * 0.002
        camera.position.y += (Math.random() - 0.5) * 0.002
        camera.position.z += (Math.random() - 0.5) * 0.002
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      resizeRenderer(camera, renderer)
    }
    window.addEventListener('resize', handleResize)

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      noiseCtxRef.current?.dispose()
      rectangle.geo.dispose()
      rectangle.edges.dispose()
      rectangle.mat.dispose()
      ground.geo.dispose()
      ground.mat.dispose()
      renderer.dispose()
      controls.dispose()
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement)
      }
    }
  }, [])

  // React to runtime toggle of randomness (create/destroy noise)
  useEffect(() => {
    if (!sceneRef.current) return
    // Dispose old
    noiseCtxRef.current?.dispose()
    // Recreate if enabled
    noiseCtxRef.current = createNoise(sceneRef.current, randomness)
  }, [randomness])

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
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            background: '#1f262c',
            color: '#e8f4ff'
          }
        }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Random Info</Typography>
          <Tooltip title="Refresh (R)">
            <IconButton size="small" onClick={refreshInfo} color="primary">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Toggle drawer (])">
            <IconButton size="small" onClick={toggleDrawer} color="primary">
              <VisibilityIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <Box sx={{ px: 2, py: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={randomness}
                onChange={toggleRandomness}
                color="primary"
                size="small"
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ShuffleIcon fontSize="small" /> Randomness (N)
              </Box>
            }
            sx={{ userSelect: 'none' }}
          />
        </Box>
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
          Hotkeys: W A S D move • C center • R refresh • ] drawer • N randomness
        </Box>
      </Drawer>
    </Box>
  )
}

export default App
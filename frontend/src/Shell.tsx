import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

type ShellProps = {
  nav?: ReactNode
  children: ReactNode
}

export function Shell({ nav, children }: ShellProps) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#12312e', color: '#f5f5f4' }}>
        <Toolbar sx={{ gap: 1.5, minHeight: 68 }}>
          <StorefrontOutlinedIcon />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
              Pickup Counter
            </Typography>
            <Typography variant="caption" sx={{ color: '#a8a29e' }}>
              Self-service snacks
            </Typography>
          </Box>
          {nav}
        </Toolbar>
      </AppBar>
      {children}
    </Box>
  )
}

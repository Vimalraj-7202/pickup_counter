import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    primary: { main: '#0f766e', dark: '#115e59', contrastText: '#ffffff' },
    background: { default: '#f4f1ea', paper: '#ffffff' },
    text: { primary: '#1c1917', secondary: '#57534e' },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.03em' },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 650 },
    button: { textTransform: 'none', fontWeight: 650 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 12 },
        sizeLarge: { minHeight: 48, paddingInline: 22 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 2px rgba(28, 25, 23, 0.05), 0 10px 28px rgba(28, 25, 23, 0.05)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
  },
})

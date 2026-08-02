/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                /* 水墨风核心色板 */
                rice: {
                    DEFAULT: '#f5f0e8',
                    dark: '#e8dfd0',
                    light: '#faf7f2',
                },
                ink: {
                    DEFAULT: '#1a1a1a',
                    light: '#3d3d3d',
                    faint: '#6b6b6b',
                    ghost: 'rgba(26,26,26,0.06)',
                },
                vermillion: {
                    DEFAULT: '#c0392b',
                    light: '#e74c3c',
                    dark: '#962d22',
                },
                'indigo-ink': {
                    DEFAULT: '#2c3e6b',
                    light: '#3d5a99',
                    dark: '#1a2744',
                },
                gold: {
                    DEFAULT: '#d4a843',
                    light: '#e8c66a',
                    dark: '#b08a30',
                },
                jade: {
                    DEFAULT: '#2d6a4f',
                    light: '#40916c',
                    dark: '#1b4332',
                },
                wood: {
                    DEFAULT: '#8b6f47',
                    light: '#c4a675',
                    dark: '#6b5535',
                },
                /* 兼容旧代码的玩家色 */
                player1: {
                    light: '#3d5a99',
                    DEFAULT: '#2c3e6b',
                    dark: '#1a2744'
                },
                player2: {
                    light: '#e74c3c',
                    DEFAULT: '#c0392b',
                    dark: '#962d22'
                }
            },
            fontFamily: {
                title: ['"Ma Shan Zheng"', '"ZCOOL KuaiLe"', 'cursive'],
                display: ['"ZCOOL KuaiLe"', '"Ma Shan Zheng"', 'cursive'],
                body: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
            },
            keyframes: {
                'ink-spread': {
                    '0%': { transform: 'scale(0.8)', opacity: '0', filter: 'blur(4px)' },
                    '50%': { opacity: '0.6', filter: 'blur(1px)' },
                    '100%': { transform: 'scale(1)', opacity: '1', filter: 'blur(0)' },
                },
                'ink-spread-full': {
                    '0%': { transform: 'scale(0)', opacity: '0' },
                    '60%': { opacity: '1' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                },
                'seal-stamp': {
                    '0%': { transform: 'scale(1.3) rotate(-5deg)', opacity: '0' },
                    '60%': { transform: 'scale(0.95) rotate(1deg)', opacity: '1' },
                    '100%': { transform: 'scale(1) rotate(-3deg)', opacity: '1' },
                },
                'cloud-float': {
                    '0%, 100%': { transform: 'translateX(0) translateY(0)' },
                    '25%': { transform: 'translateX(30px) translateY(-5px)' },
                    '50%': { transform: 'translateX(60px) translateY(0)' },
                    '75%': { transform: 'translateX(30px) translateY(5px)' },
                },
                'scroll-unfurl': {
                    '0%': { transform: 'scaleY(0)', opacity: '0' },
                    '60%': { transform: 'scaleY(1.02)', opacity: '1' },
                    '100%': { transform: 'scaleY(1)', opacity: '1' },
                },
                'pulse-glow': {
                    '0%, 100%': { boxShadow: '0 0 4px 1px rgba(212,168,67,0.3)' },
                    '50%': { boxShadow: '0 0 12px 4px rgba(212,168,67,0.6)' },
                },
                'brush-draw': {
                    '0%': { width: '0%' },
                    '100%': { width: '100%' },
                },
                'fade-up': {
                    '0%': { transform: 'translateY(10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                'float-gentle': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-6px)' },
                },
            },
            animation: {
                'ink-spread': 'ink-spread 0.5s ease-out forwards',
                'ink-spread-full': 'ink-spread-full 0.6s ease-out forwards',
                'seal-stamp': 'seal-stamp 0.35s ease-out forwards',
                'cloud-float': 'cloud-float 25s ease-in-out infinite',
                'cloud-float-slow': 'cloud-float 40s ease-in-out infinite reverse',
                'scroll-unfurl': 'scroll-unfurl 0.5s ease-out forwards',
                'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
                'brush-draw': 'brush-draw 0.6s ease-out forwards',
                'fade-up': 'fade-up 0.4s ease-out forwards',
                'float-gentle': 'float-gentle 3s ease-in-out infinite',
            },
        },
    },
    plugins: [],
}

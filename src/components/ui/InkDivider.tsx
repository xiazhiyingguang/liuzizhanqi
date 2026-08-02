interface InkDividerProps {
    variant?: 'brush' | 'cloud' | 'wave';
    className?: string;
}

function BrushDivider({ className = '' }: { className?: string }) {
    return (
        <svg className={`w-full h-3 ${className}`} viewBox="0 0 400 12" preserveAspectRatio="none" fill="none">
            <path
                d="M0 6 Q20 2 40 6 Q60 10 80 6 Q120 2 160 6 Q200 10 240 6 Q280 2 320 6 Q360 10 380 6 Q390 4 400 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity="0.3"
            />
        </svg>
    );
}

function CloudDivider({ className = '' }: { className?: string }) {
    return (
        <svg className={`w-full h-5 ${className}`} viewBox="0 0 400 20" preserveAspectRatio="none" fill="none">
            <path
                d="M0 15 Q30 5 60 12 Q80 4 100 10 Q120 2 145 10 Q170 4 200 12 Q220 5 250 10 Q280 2 310 10 Q340 5 370 12 Q390 6 400 12"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.2"
            />
            <circle cx="100" cy="8" r="1.5" fill="currentColor" opacity="0.15" />
            <circle cx="250" cy="6" r="1" fill="currentColor" opacity="0.1" />
        </svg>
    );
}

function WaveDivider({ className = '' }: { className?: string }) {
    return (
        <svg className={`w-full h-4 ${className}`} viewBox="0 0 400 16" preserveAspectRatio="none" fill="none">
            <path
                d="M0 8 C20 2 40 14 60 8 C80 2 100 14 120 8 C140 2 160 14 180 8 C200 2 220 14 240 8 C260 2 280 14 300 8 C320 2 340 14 360 8 C380 2 400 14 400 8"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.2"
            />
        </svg>
    );
}

export default function InkDivider({ variant = 'brush', className = '' }: InkDividerProps) {
    const DividerComponent = {
        brush: BrushDivider,
        cloud: CloudDivider,
        wave: WaveDivider,
    }[variant];

    return <DividerComponent className={className} />;
}

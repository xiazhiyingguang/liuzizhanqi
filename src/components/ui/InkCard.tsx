import { ReactNode, HTMLAttributes } from 'react';

interface InkCardProps extends HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'elevated' | 'selected' | 'interactive';
    children: ReactNode;
}

const baseClasses = 'ink-paper ink-border rounded-md transition-all duration-200';

const variantClasses = {
    default: '',
    elevated: 'shadow-md shadow-ink/5',
    selected: 'ring-2 ring-gold shadow-lg shadow-gold/15 animate-pulse-glow',
    interactive: 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-ink/10',
};

export default function InkCard({
    variant = 'default',
    children,
    className = '',
    ...props
}: InkCardProps) {
    return (
        <div
            className={`${baseClasses} ${variantClasses[variant]} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
}

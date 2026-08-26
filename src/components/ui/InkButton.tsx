import { ButtonHTMLAttributes, ReactNode } from 'react';
import type { UiClickSound } from '../../audio/audio-manager';

interface InkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    children: ReactNode;
    /** 点击音效类别：渲染为 data-sfx 标签供全局点击委托读取 */
    sfx?: UiClickSound;
}

const baseClasses = 'inline-flex items-center justify-center transition-all duration-200 font-body select-none';

const variantClasses = {
    primary: [
        'bg-vermillion text-rice-light border-2 border-vermillion',
        'hover:brightness-110 hover:shadow-lg hover:shadow-vermillion/20',
        'active:scale-[0.97]',
        'disabled:opacity-40 disabled:grayscale disabled:pointer-events-none',
        'font-title tracking-wider',
    ].join(' '),
    secondary: [
        'bg-rice text-ink border-2 border-ink/20',
        'hover:border-ink/40 hover:bg-rice-dark',
        'active:scale-[0.97]',
        'disabled:opacity-40 disabled:grayscale disabled:pointer-events-none',
    ].join(' '),
    ghost: [
        'bg-transparent text-ink-light border border-transparent',
        'hover:text-ink hover:border-ink/15 hover:bg-ink-ghost',
        'disabled:opacity-30 disabled:pointer-events-none',
    ].join(' '),
};

const sizeClasses = {
    sm: 'px-4 py-1.5 text-sm rounded',
    md: 'px-6 py-2.5 text-base rounded-md',
    lg: 'px-10 py-3.5 text-lg rounded-md',
};

export default function InkButton({
    variant = 'secondary',
    size = 'md',
    children,
    className = '',
    disabled,
    sfx,
    ...props
}: InkButtonProps) {
    return (
        <button
            className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
            disabled={disabled}
            data-sfx={sfx}
            {...props}
        >
            {children}
        </button>
    );
}

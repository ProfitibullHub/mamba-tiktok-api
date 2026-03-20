import { memo, useRef, useCallback, useEffect, useMemo } from 'react';
import {
    Bold, Italic, Underline, List, ListOrdered,
    AlignLeft, AlignCenter, AlignRight, Link, Type, Heading1, Heading2, Heading3
} from 'lucide-react';

interface RichTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

interface ToolbarButtonProps {
    icon: React.ReactNode;
    title: string;
    onClick: () => void;
    isActive?: boolean;
}

// Memoized toolbar button to prevent unnecessary re-renders
const ToolbarButton = memo(({ icon, title, onClick, isActive }: ToolbarButtonProps) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
        className={`p-2 rounded-md transition-colors ${isActive
                ? 'bg-pink-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
    >
        {icon}
    </button>
));

ToolbarButton.displayName = 'ToolbarButton';

const ToolbarDivider = memo(() => (
    <div className="w-px h-6 bg-gray-700 mx-1" />
));

ToolbarDivider.displayName = 'ToolbarDivider';

// Pre-render icons to avoid creating new elements on each render
const icons = {
    bold: <Bold size={16} />,
    italic: <Italic size={16} />,
    underline: <Underline size={16} />,
    h1: <Heading1 size={16} />,
    h2: <Heading2 size={16} />,
    h3: <Heading3 size={16} />,
    type: <Type size={16} />,
    list: <List size={16} />,
    listOrdered: <ListOrdered size={16} />,
    alignLeft: <AlignLeft size={16} />,
    alignCenter: <AlignCenter size={16} />,
    alignRight: <AlignRight size={16} />,
    link: <Link size={16} />
};

function RichTextEditorComponent({ value, onChange, placeholder, className }: RichTextEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null);
    const isInitialized = useRef(false);
    const lastValue = useRef(value);
    const debounceTimer = useRef<NodeJS.Timeout | null>(null);

    // Initialize editor content only once
    useEffect(() => {
        if (editorRef.current && !isInitialized.current) {
            editorRef.current.innerHTML = value || '';
            isInitialized.current = true;
            lastValue.current = value;
        }
    }, [value]);

    // Debounced onChange to reduce re-renders
    const debouncedOnChange = useCallback((html: string) => {
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
        }
        debounceTimer.current = setTimeout(() => {
            if (html !== lastValue.current) {
                lastValue.current = html;
                onChange(html);
            }
        }, 150);
    }, [onChange]);

    // Cleanup debounce timer
    useEffect(() => {
        return () => {
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }
        };
    }, []);

    // Execute formatting command - stable reference
    const execCommand = useCallback((command: string, commandValue?: string) => {
        document.execCommand(command, false, commandValue);
        editorRef.current?.focus();

        // Trigger onChange immediately for formatting commands
        if (editorRef.current) {
            const html = editorRef.current.innerHTML;
            lastValue.current = html;
            onChange(html);
        }
    }, [onChange]);

    // Handle input changes with debounce
    const handleInput = useCallback(() => {
        if (editorRef.current) {
            debouncedOnChange(editorRef.current.innerHTML);
        }
    }, [debouncedOnChange]);

    // Memoized command handlers to prevent recreation
    const handlers = useMemo(() => ({
        bold: () => execCommand('bold'),
        italic: () => execCommand('italic'),
        underline: () => execCommand('underline'),
        h1: () => execCommand('formatBlock', '<h1>'),
        h2: () => execCommand('formatBlock', '<h2>'),
        h3: () => execCommand('formatBlock', '<h3>'),
        p: () => execCommand('formatBlock', '<p>'),
        unorderedList: () => execCommand('insertUnorderedList'),
        orderedList: () => execCommand('insertOrderedList'),
        alignLeft: () => execCommand('justifyLeft'),
        alignCenter: () => execCommand('justifyCenter'),
        alignRight: () => execCommand('justifyRight'),
        link: () => {
            const url = prompt('Enter URL:');
            if (url) execCommand('createLink', url);
        }
    }), [execCommand]);

    const containerClass = useMemo(() =>
        `bg-gray-800 border border-gray-700 rounded-lg overflow-hidden ${className || ''}`,
        [className]
    );

    return (
        <div className={containerClass}>
            {/* Toolbar - Using stable icon references and handlers */}
            <div className="flex flex-wrap items-center gap-0.5 p-2 border-b border-gray-700 bg-gray-900/50">
                <ToolbarButton icon={icons.bold} title="Bold (Ctrl+B)" onClick={handlers.bold} />
                <ToolbarButton icon={icons.italic} title="Italic (Ctrl+I)" onClick={handlers.italic} />
                <ToolbarButton icon={icons.underline} title="Underline (Ctrl+U)" onClick={handlers.underline} />

                <ToolbarDivider />

                <ToolbarButton icon={icons.h1} title="Heading 1" onClick={handlers.h1} />
                <ToolbarButton icon={icons.h2} title="Heading 2" onClick={handlers.h2} />
                <ToolbarButton icon={icons.h3} title="Heading 3" onClick={handlers.h3} />
                <ToolbarButton icon={icons.type} title="Normal Text" onClick={handlers.p} />

                <ToolbarDivider />

                <ToolbarButton icon={icons.list} title="Bullet List" onClick={handlers.unorderedList} />
                <ToolbarButton icon={icons.listOrdered} title="Numbered List" onClick={handlers.orderedList} />

                <ToolbarDivider />

                <ToolbarButton icon={icons.alignLeft} title="Align Left" onClick={handlers.alignLeft} />
                <ToolbarButton icon={icons.alignCenter} title="Align Center" onClick={handlers.alignCenter} />
                <ToolbarButton icon={icons.alignRight} title="Align Right" onClick={handlers.alignRight} />

                <ToolbarDivider />

                <ToolbarButton icon={icons.link} title="Insert Link" onClick={handlers.link} />
            </div>

            {/* Editor Area */}
            <div
                ref={editorRef}
                contentEditable
                onInput={handleInput}
                data-placeholder={placeholder}
                className="min-h-[200px] max-h-[400px] overflow-y-auto p-4 text-gray-300 text-sm leading-relaxed focus:outline-none
                    [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-500 [&:empty]:before:pointer-events-none
                    [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-2
                    [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mb-2
                    [&_h3]:text-base [&_h3]:font-medium [&_h3]:text-white [&_h3]:mb-2
                    [&_p]:mb-2
                    [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2
                    [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2
                    [&_li]:mb-1
                    [&_a]:text-pink-400 [&_a]:underline
                    [&_strong]:font-bold [&_strong]:text-white
                    [&_em]:italic
                    [&_u]:underline"
                suppressContentEditableWarning
            />
        </div>
    );
}

// Memoize the entire component
export const RichTextEditor = memo(RichTextEditorComponent);

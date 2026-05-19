import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalculationTooltip } from './CalculationTooltip';

describe('CalculationTooltip', () => {
    it('shows source text after opening the panel', () => {
        const { container } = render(
            <CalculationTooltip source="Unit test source" calculation="a + b" api="GET /example" />,
        );
        expect(screen.queryByText('Unit test source')).not.toBeInTheDocument();

        const trigger = container.querySelector('.cursor-help')?.parentElement;
        expect(trigger).toBeTruthy();
        fireEvent.click(trigger!);

        expect(screen.getByText('Unit test source')).toBeInTheDocument();
        expect(screen.getByText('a + b')).toBeInTheDocument();
        expect(screen.getByText('GET /example')).toBeInTheDocument();
    });
});

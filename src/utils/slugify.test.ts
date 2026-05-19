import { describe, it, expect } from 'vitest';
import { matchesSlug, slugify } from './slugify';

describe('slugify', () => {
    it('lowercases, trims, and replaces spaces with hyphens', () => {
        expect(slugify('  Hello World  ')).toBe('hello-world');
    });

    it('strips non-alphanumeric characters', () => {
        expect(slugify('Shop #1 (NYC)!')).toBe('shop-1-nyc');
    });

    it('collapses repeated hyphens and trims edges', () => {
        expect(slugify('a---b')).toBe('a-b');
    });
});

describe('matchesSlug', () => {
    it('returns true when slugified name equals slug', () => {
        expect(matchesSlug('My Shop Name', 'my-shop-name')).toBe(true);
    });
});

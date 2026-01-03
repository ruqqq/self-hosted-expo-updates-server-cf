/**
 * HTM + Preact setup
 * This file binds htm to preact's h function
 */
import { h } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);

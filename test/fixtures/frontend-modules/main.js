import { count, increment } from './counter.js';

export function bump() {
    increment();
    return count();
}

export function pageTitle() {
    return document.title;
}

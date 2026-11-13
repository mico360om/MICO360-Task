import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { LessonFooter } from './LessonFooter';
import { fakeLearner, lesson, renderOnSide } from './training-fixtures';

const footer = () => within(document.querySelector<HTMLElement>('[data-lesson-footer]')!);

describe('the lesson footer (13 Nov new look): one bar on every kind of lesson', () => {
  it('Previous lesson at the start (the lesson before, the person’s own), the way on at the end', () => {
    renderOnSide(<LessonFooter lesson={lesson()} status={<span>Read</span>} next={<button type="button">Next lesson</button>} />, { api: fakeLearner() });
    expect(footer().getByRole('link', { name: 'Previous lesson' })).toHaveAttribute('href', '/training/courses/c1/lessons/l1');
    expect(footer().getByText('Read')).toBeInTheDocument();
    expect(footer().getByRole('button', { name: 'Next lesson' })).toBeInTheDocument();
    // The previous one first, the way on last (reading order = the bar's order).
    const controls = [...document.querySelector('[data-lesson-footer]')!.querySelectorAll('a, button')].map((el) => el.textContent);
    expect(controls).toEqual(['Previous lesson', 'Next lesson']);
  });

  it('the first lesson: nothing at the start; a lesson with no way on yet (a quiz not passed): only Previous lesson', () => {
    const one = renderOnSide(<LessonFooter lesson={lesson({ prevLessonId: null })} next={<button type="button">Next lesson</button>} />, { api: fakeLearner() });
    expect(footer().queryByRole('link', { name: 'Previous lesson' })).toBeNull();
    one.unmount();
    renderOnSide(<LessonFooter lesson={lesson()} />, { api: fakeLearner() });
    expect(footer().getAllByRole('link').map((l) => l.textContent)).toEqual(['Previous lesson']);
  });

  it('a guide’s Back (to its step before) in place of Previous lesson', () => {
    renderOnSide(<LessonFooter lesson={lesson()} back={<button type="button">Back</button>} next={<button type="button">Next</button>} />, { api: fakeLearner() });
    expect(footer().queryByRole('link', { name: 'Previous lesson' })).toBeNull();
    expect(footer().getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('in the Client portal: the portal’s address', () => {
    renderOnSide(<LessonFooter lesson={lesson()} />, { api: fakeLearner(), portal: true });
    expect(screen.getByRole('link', { name: 'Previous lesson' })).toHaveAttribute('href', '/portal/training/courses/c1/lessons/l1');
  });
});

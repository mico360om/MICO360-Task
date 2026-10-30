import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClientPrivacyPage, PrivacyPage, TermsPage } from './LegalPages';

describe('public privacy policy and terms', () => {
  it('renders the privacy policy with the data-download instructions and a contact', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByText(/download my data/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /info@mico360\.com/i })[0]).toHaveAttribute('href', 'mailto:info@mico360.com');
    expect(screen.queryByText(/support@mico360/i)).toBeNull();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('a privacy notice written for clients: what they see and never see, signing in, their email address, whom to ask (owner, 30 Oct)', () => {
    render(<MemoryRouter><ClientPrivacyPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice for clients' })).toBeInTheDocument();
    for (const name of ['What you can see', 'What the page never shows', 'Signing in', 'Your email address', 'Questions']) {
      expect(screen.getByRole('heading', { level: 2, name }), name).toBeInTheDocument();
    }
    const text = document.body.textContent ?? '';
    for (const s of [
      'Only what the company chose to share with you',
      'each one’s title, status and due date',
      'the meeting minutes it approved and marked for you',
      'the inspector’s notes on each item and the names of the people who signed them',
      'comments, files, task descriptions',
      'A code lasts 10 minutes, and only the newest one works.',
      'stays signed in to this one page for 30 days',
      'It is used only to send you the invitation, any new link, and your sign-in codes.',
      'contact the company that shared the project with you',
    ]) expect(text, s).toContain(s);
    // Nothing of the staff app: no staff sign-in, no data download, no MICO360 address to write to.
    expect(screen.queryByRole('link', { name: /back to sign in/i })).toBeNull();
    expect(screen.queryByText(/download my data/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /info@mico360\.com/i })).toBeNull();
  });

  it('renders the terms of use and links to the privacy policy', () => {
    render(<MemoryRouter><TermsPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: /terms of use/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
  });
});

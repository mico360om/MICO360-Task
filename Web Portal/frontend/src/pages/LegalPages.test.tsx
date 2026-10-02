import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPage, TermsPage } from './LegalPages';

describe('public privacy policy and terms', () => {
  it('renders the privacy policy with the data-download instructions and a contact', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByText(/download my data/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /support@mico360\.com/i })[0]).toHaveAttribute('href', 'mailto:support@mico360.com');
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('renders the terms of use and links to the privacy policy', () => {
    render(<MemoryRouter><TermsPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: /terms of use/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
  });
});

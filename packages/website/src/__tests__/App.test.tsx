import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders the hotshare logo', () => {
    render(<App />);
    expect(screen.getAllByText('hotshare').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the headline', () => {
    render(<App />);
    expect(screen.getAllByText(/Turn any PC or phone/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the accent text "WiFi hotspot"', () => {
    render(<App />);
    expect(screen.getAllByText('WiFi hotspot').length).toBeGreaterThanOrEqual(1);
  });

  it('renders all four download buttons', () => {
    render(<App />);
    expect(screen.getAllByText('Download for Windows').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Get on Android').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Download for Linux').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Download for macOS').length).toBeGreaterThanOrEqual(1);
  });

  it('windows download links to correct URL', () => {
    render(<App />);
    const btn = screen.getAllByText('Download for Windows')[0].closest('a');
    expect(btn).toHaveAttribute('href', expect.stringContaining('hotshare-setup.exe'));
    expect(btn).toHaveAttribute('download');
  });

  it('android download links to correct URL', () => {
    render(<App />);
    const btn = screen.getAllByText('Get on Android')[0].closest('a');
    expect(btn).toHaveAttribute('href', expect.stringContaining('hotshare.apk'));
    expect(btn).toHaveAttribute('download');
  });

  it('linux download links to correct URL', () => {
    render(<App />);
    const btn = screen.getAllByText('Download for Linux')[0].closest('a');
    expect(btn).toHaveAttribute('href', expect.stringContaining('AppImage'));
    expect(btn).toHaveAttribute('download');
  });

  it('macos download links to correct URL', () => {
    render(<App />);
    const btn = screen.getAllByText('Download for macOS')[0].closest('a');
    expect(btn).toHaveAttribute('href', expect.stringContaining('.dmg'));
    expect(btn).toHaveAttribute('download');
  });

  it('renders hero meta info', () => {
    render(<App />);
    expect(screen.getAllByText(/Windows, macOS, Linux, and Android/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1-month free trial/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/No credit card required/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders footer with copyright', () => {
    render(<App />);
    expect(screen.getAllByText(/hotshare.*2026/).length).toBeGreaterThanOrEqual(1);
  });
});

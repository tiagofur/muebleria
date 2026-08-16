import { TextStyle } from 'react-native';

export const typography = {
  h1: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  } as TextStyle,
  h2: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 26,
  } as TextStyle,
  h3: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  } as TextStyle,
  body: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  } as TextStyle,
  bodyBold: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  } as TextStyle,
  caption: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  } as TextStyle,
  captionBold: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  } as TextStyle,
  mono: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
  } as TextStyle,
  priceHero: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
  } as TextStyle,
} as const;

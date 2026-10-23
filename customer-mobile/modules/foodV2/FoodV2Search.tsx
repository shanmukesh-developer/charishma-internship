/**
 * Food & groceries v2: search results (shares the listing logic: group chips, or a category sidebar when results span several categories).
 * Others → Food & groceries (modules/foodV2).
 */
import React from 'react';
import { SEARCH } from './FoodV2Data';
import FoodV2Listing from './FoodV2Listing';

export default function FoodV2Search() {
  return <FoodV2Listing shelf={SEARCH} />;
}

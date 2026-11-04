/**
 * Mounts Co-Ride v2: the data provider, the router-backed navigator for the screen's URL, the screen, and the
 * sheets. `CoRideV2Screen` is a full-screen app/coride/* route; `CoRideV2OthersSection` is the home inside
 * the Others shell (which provides the blue section header and the scroll view).
 */
import React from 'react';
import { View } from 'react-native';
import { CR } from './coRideV2Theme';
import { useTheme } from '../../context/ThemeContext';
import { CoRideV2Provider } from './coRideV2Data';
import { CoRideV2Nav, useRouteFromParams, type ScreenName } from './coRideV2Nav';
import { CoRideV2HomeBody } from './CoRideV2Home';
import CoRideV2Find from './CoRideV2Find';
import CoRideV2RideDetail from './CoRideV2RideDetail';
import CoRideV2Post from './CoRideV2Post';
import CoRideV2MyRides from './CoRideV2MyRides';
import CoRideV2Auto from './CoRideV2Auto';
import CoRideV2RegularScreen from './CoRideV2RegularScreen';
import CoRideV2Sheets from './CoRideV2Sheets';

const VIEWS: Record<Exclude<ScreenName, 'home'>, React.ComponentType> = {
  find: CoRideV2Find, ride: CoRideV2RideDetail, post: CoRideV2Post, mine: CoRideV2MyRides, auto: CoRideV2Auto, regular: CoRideV2RegularScreen,
};

/** Redraws the section when the app's theme changes (colours come from CR at render, utils/themeNow). */
function ThemeKeyed({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();
  return <React.Fragment key={isDark ? 'dark' : 'light'}>{children}</React.Fragment>;
}

function Routed({ name }: { name: Exclude<ScreenName, 'home'> }) {
  const route = useRouteFromParams(name);
  const View_ = VIEWS[name];
  return (
    <CoRideV2Nav route={route}>
      <ThemeKeyed>
        <View style={{ flex: 1, backgroundColor: CR.page }}>
          <View_ />
          <CoRideV2Sheets />
        </View>
      </ThemeKeyed>
    </CoRideV2Nav>
  );
}

/** A full-screen Co-Ride v2 route (app/coride/*). */
export function CoRideV2Screen({ name }: { name: Exclude<ScreenName, 'home'> }) {
  return <CoRideV2Provider><Routed name={name} /></CoRideV2Provider>;
}

/** The Co-Ride v2 home for Others → Co-Ride (the shell provides the header and the scroll view). */
export function CoRideV2OthersSection() {
  return (
    <CoRideV2Provider>
      <CoRideV2Nav route={{ name: 'home' }}>
        <ThemeKeyed>
          <CoRideV2HomeBody />
          <CoRideV2Sheets />
        </ThemeKeyed>
      </CoRideV2Nav>
    </CoRideV2Provider>
  );
}

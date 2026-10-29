import unittest
from gtfs_sources import local_rail, read_feed


class RailSelection(unittest.TestCase):
    def test_outside_stops_split_trips_instead_of_creating_shortcuts(self):
        # A train leaves the offline coverage and later returns. Keep two rides;
        # removing only the outside stop would falsely connect B directly to D.
        names = ['A', 'B', 'Outside', 'D', 'E']
        feed = {key: [] for key in ['stops','routes','trips','stop_times','shapes','calendar','calendar_dates']}
        feed['stops'] = [{'stop_id': n, 'stop_name': n, 'stop_lon':str(i+1), 'stop_lat':'1' if n!='Outside' else '3'} for i,n in enumerate(names)]
        feed['routes'] = [{'route_id':'r','route_type':'2'}]
        feed['trips'] = [{'trip_id':'t','route_id':'r','service_id':'s','shape_id':'shape'}]
        feed['stop_times'] = [{'trip_id':'t','stop_id':n,'stop_sequence':str(i),'arrival_time':f'08:0{i}:00','departure_time':f'08:0{i}:00'} for i,n in enumerate(names)]
        feed['shapes'] = [{'shape_id':'shape','shape_pt_sequence':str(i),'shape_pt_lon':str(i+1),'shape_pt_lat':'1' if n!='Outside' else '3'} for i,n in enumerate(names)]
        feed['calendar'] = [{'service_id':'s'}]
        result = local_rail(feed,[0,0,6,2])
        self.assertEqual(len(result['trips']),2)
        self.assertEqual([r['stop_id'] for r in result['stop_times']],['elron:A','elron:B','elron:D','elron:E'])
        self.assertEqual([r['arrival_time'] for r in result['stop_times']],['08:00:00','08:01:00','08:03:00','08:04:00'])
        self.assertEqual([len([r for r in result['shapes'] if r['shape_id']==t['shape_id']]) for t in result['trips']],[2,2])
        self.assertEqual(result['calendar'][0]['service_id'],'elron:s')

    def test_real_feed_preserves_times_restrictions_and_source_station_names(self):
        original = read_feed('data/source/elron-gtfs.zip')
        result = local_rail(original,[24.45,59.28,25.04,59.57])
        original_times = {(r['trip_id'],r['stop_sequence']):r for r in original['stop_times']}
        for row in result['stop_times']:
            source = original_times[(row['trip_id'].removeprefix('elron:'),row['stop_sequence'])]
            for field in ['arrival_time','departure_time','pickup_type','drop_off_type']:
                self.assertEqual(row.get(field),source.get(field))
        self.assertEqual(len(result['stops']),48)
        self.assertTrue(all(s['stop_name']=='Balti jaam' for s in result['stops'] if s['source_name']=='Tallinn'))
        self.assertTrue(all(len([r for r in result['stop_times'] if r['trip_id']==t['trip_id']])>=2 for t in result['trips']))


if __name__ == '__main__':
    unittest.main()

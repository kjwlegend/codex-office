"""Browser-triggered refresh uses a single background job and preserves failures."""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from workspace_server import WorkspaceServer


class UsageRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.report=Path(self.temp.name)/'report.html';self.report.write_text('previous snapshot')
        self.servers=[];self.addCleanup(self.close)

    def close(self):
        for server in self.servers:
            server.shutdown();server.server_close()

    def start(self, callback=None):
        server=WorkspaceServer(('127.0.0.1',0),None,self.report,refresh_usage=callback)
        self.servers.append(server)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        return server

    def request(self, server, method='GET', token=True, origin=True, data=b'{}'):
        base=f'http://127.0.0.1:{server.server_port}'
        headers={'Content-Type':'application/json'}
        if token:headers['X-Workspace-Token']=server.edit_token
        if origin:headers['Origin']=base
        req=Request(base+'/api/usage-refresh',data=data if method=='POST' else None,headers=headers,method=method)
        with urlopen(req) as response:return response.status,json.load(response)

    def await_done(self, server):
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            state=server.usage_status()
            if state['status']!='running':return state
            time.sleep(.01)
        self.fail('Background update did not finish')

    def test_only_one_update_runs_and_read_status_is_nonblocking(self):
        release=threading.Event();self.addCleanup(release.set);calls=[]
        def refresh():calls.append(1);release.wait(2);self.report.write_text('new snapshot')
        server=self.start(refresh)
        a=self.request(server,'POST');b=self.request(server,'POST')
        self.assertEqual(a[0],202);self.assertEqual(a[1]['revision'],b[1]['revision'])
        self.assertEqual(self.request(server)[1]['status'],'running')
        release.set();self.assertEqual(self.await_done(server)['status'],'succeeded')
        self.assertEqual(calls,[1]);self.assertEqual(self.report.read_text(),'new snapshot')

    def test_failed_job_keeps_existing_report_and_can_be_retried(self):
        def refresh():raise OSError('synthetic source failure')
        server=self.start(refresh);self.request(server,'POST')
        state=self.await_done(server)
        self.assertEqual(state['status'],'failed');self.assertIn('synthetic',state['error'])
        self.assertEqual(self.report.read_text(),'previous snapshot')
        self.request(server,'POST');self.assertEqual(self.await_done(server)['revision'],2)

    def test_origin_token_and_fixed_arguments_are_enforced(self):
        calls=[];server=self.start(lambda:calls.append(1))
        for token,origin in ((False,True),(True,False)):
            with self.assertRaises(HTTPError) as error:self.request(server,'POST',token,origin)
            self.assertEqual(error.exception.code,403);error.exception.close()
        with self.assertRaises(HTTPError) as error:self.request(server,'POST',data=b'{"command":"anything"}')
        self.assertEqual(error.exception.code,400);error.exception.close();self.assertEqual(calls,[])

    def test_old_or_test_server_reports_refresh_unavailable(self):
        server=self.start();self.assertFalse(self.request(server)[1]['available'])
        with self.assertRaises(HTTPError) as error:self.request(server,'POST')
        self.assertEqual(error.exception.code,400);error.exception.close()
